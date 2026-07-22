import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { loadLlmConfig, type LlmConfig } from './llm.config'

/** LLM 消息格式（OpenAI 风格） */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; args: any }>
}

/** LLM 工具定义（Vercel AI SDK tool() 风格） */
export interface LlmTool {
  name: string
  description: string
  inputSchema: Record<string, any>  // JSON Schema
  execute: (args: any, ctx?: any) => Promise<any>
  /** 是否需要人工确认（资金类操作必须 true） */
  requireConfirm?: boolean
}

/** LLM 调用结果 */
export interface LlmResult {
  content: string
  toolCalls?: Array<{ id: string; name: string; args: any }>
  tokens?: number
  model: string
}

/**
 * LLM 服务封装：
 *  - LLM_PROVIDER=mock 时降级为本地模板引擎（复用 RiskAuditAiEngine 模式）
 *  - 非 mock 时调用 Vercel AI SDK（@ai-sdk/openai）走 OpenAI 兼容协议
 *
 * 设计原则：
 *  1. 对上层 AgentService 暴露统一的 chat() 接口
 *  2. 工具调用循环封装在内部（maxSteps 默认 10）
 *  3. 超时/失败时降级为 mock 模板，保证可用性
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private readonly config: LlmConfig
  private dynamicSdk: any = null
  private dynamicInitFailed = false

  constructor(configService: ConfigService) {
    this.config = loadLlmConfig(configService)
  }

  /** 当前 provider（供 AgentService 判断是否真 LLM） */
  get provider(): string {
    return this.config.provider
  }

  get isMock(): boolean {
    return this.config.provider === 'mock'
  }

  /**
   * 动态加载 Vercel AI SDK（避免在 mock 模式下加载失败导致整个应用起不来）
   */
  private async getSdk(): Promise<any> {
    if (this.dynamicInitFailed) return null
    if (this.dynamicSdk) return this.dynamicSdk
    try {
      // 动态 import 避免静态依赖导致 mock 模式启动失败
      const ai = await import('ai')
      const openai = await import('@ai-sdk/openai')
      this.dynamicSdk = { ai, openai }
      return this.dynamicSdk
    } catch (err: any) {
      this.logger.warn(`Vercel AI SDK 加载失败，降级为 mock 模式: ${err.message}`)
      this.dynamicInitFailed = true
      return null
    }
  }

  /**
   * 核心调用入口
   * @param messages 对话历史
   * @param tools 可用工具（可选）
   * @param systemPrompt 系统提示词
   * @param maxSteps 工具调用最大步数，默认 10
   */
  async chat(input: {
    messages: LlmMessage[]
    tools?: LlmTool[]
    systemPrompt?: string
    maxSteps?: number
  }): Promise<LlmResult> {
    // mock 模式：直接返回固定模板（兼容 RiskAuditAiEngine 的现有行为）
    if (this.isMock) {
      return this.mockChat(input.messages, input.tools ?? [])
    }

    const sdk = await this.getSdk()
    if (!sdk) {
      // SDK 加载失败也降级
      return this.mockChat(input.messages, input.tools ?? [])
    }

    try {
      return await this.callWithSdk(sdk, input)
    } catch (err: any) {
      this.logger.error(`LLM 调用失败，降级为 mock: ${err.message}`, err.stack)
      return this.mockChat(input.messages, input.tools ?? [])
    }
  }

  /** 使用 Vercel AI SDK 真正调用 LLM */
  private async callWithSdk(sdk: any, input: {
    messages: LlmMessage[]
    tools?: LlmTool[]
    systemPrompt?: string
    maxSteps?: number
  }): Promise<LlmResult> {
    const { generateText, tool } = sdk.ai
    const { createOpenAI } = sdk.openai

    const openaiClient = createOpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
    })
    // 显式用 .chat() 走 Chat Completions API（兼容 OpenAI 兼容网关如 hcnsec.cn / DeepSeek / Moonshot / 通义）
    // 默认 .responses() 走 OpenAI Responses API，多数第三方网关不完全兼容
    const model = openaiClient.chat(this.config.model)

    // 把 LlmTool 转换为 Vercel AI SDK 的 tool() 格式
    const toolsObj: Record<string, any> = {}
    for (const t of input.tools ?? []) {
      toolsObj[t.name] = tool({
        description: t.description,
        parameters: t.inputSchema,
        execute: t.execute,
      })
    }

    const result = await generateText({
      model,
      system: input.systemPrompt,
      messages: input.messages as any,
      tools: toolsObj,
      maxSteps: input.maxSteps ?? 10,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      abortSignal: AbortSignal.timeout(this.config.timeoutMs),
    })

    return {
      content: result.text,
      toolCalls: result.toolCalls?.map((tc: any) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        args: tc.args,
      })),
      tokens: result.usage?.totalTokens,
      model: this.config.model,
    }
  }

  /**
   * mock 模式：简单的关键词匹配模板
   * 复用 RiskAuditAiEngine 的设计思路，保证测试在无 LLM 环境下也能跑
   */
  private async mockChat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResult> {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    const content = (lastUserMsg?.content ?? '').toLowerCase()

    // 简单关键词路由
    let reply = ''
    if (content.includes('余额') || content.includes('balance')) {
      reply = `[mock] 您的余额查询请求已收到。请使用 kbpay_query_balance 工具查询。可用工具数: ${tools.length}`
    } else if (content.includes('账单') || content.includes('bill')) {
      reply = `[mock] 已为您查询账单，请使用 kbpay_query_bill 工具查看明细。`
    } else if (content.includes('转') && content.includes('钱')) {
      reply = `[mock] 转账请求已收到，请确认收款人与金额。该操作需要您二次确认。`
    } else if (content.includes('红包')) {
      reply = `[mock] 红包功能已就绪，请使用 kbpay_send_red_packet 工具发起。`
    } else if (content.includes('对账') || content.includes('reconcil')) {
      reply = `[mock] 对账任务已记录，正在分析差异。`
    } else if (content.includes('风控') || content.includes('risk')) {
      reply = `[mock] 风控审计官模式：正在扫描异常事件。`
    } else {
      reply = `[mock] 我已收到您的请求：「${lastUserMsg?.content ?? ''}」。\n当前为 mock 模式，配置 LLM_PROVIDER=openai/deepseek 等可启用真实 LLM。\n可用工具: ${tools.map((t) => t.name).join(', ')}`
    }

    return {
      content: reply,
      model: 'mock',
    }
  }
}
