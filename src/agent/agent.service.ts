import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { LlmService, type LlmMessage } from './llm/llm.service'
import { ToolRegistry, type ToolDeps } from './tools/tool.registry'
import { AgentAuditLogService } from './agent-audit-log.service'
import { MessagesService } from '../messages/messages.service'
import { CouponsService } from '../coupons/coupons.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { generateOrderNo } from '../common/helpers'
import {
  AGENT_ROLE_USER,
  AGENT_ROLE_ASSISTANT,
  AGENT_ROLE_SYSTEM,
  AGENT_RESULT_PENDING_CONFIRM,
  AGENT_RESULT_SUCCESS,
  AGENT_RESULT_REJECTED,
  AGENT_GENESIS_HASH,
} from '../common/constants'
import type { AgentCurrentUser } from './agent-current-user.interface'

const MAX_TURNS = 20  // 单次对话最大轮数，防止无限循环

/**
 * AgentService 是 Agent 模块的核心编排服务：
 *  - 创建/关闭会话
 *  - 调用 LLM（含工具调用循环）
 *  - 资金类操作强制二次确认（写入 PENDING_CONFIRM 日志，等待用户决策）
 *
 * 设计原则：
 *  1. 所有 LLM 调用失败时降级为 mock 模板
 *  2. requireConfirm=true 的工具不会立即执行，而是写入待确认日志
 *  3. confirm/reject 接口由用户主动调用，超时自动回滚
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name)
  private readonly toolDeps: ToolDeps

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly toolRegistry: ToolRegistry,
    private readonly auditLog: AgentAuditLogService,
    private readonly messagesService: MessagesService,
    private readonly couponsService: CouponsService,
    private readonly scheduleHealthService: ScheduleHealthService,
    private readonly configService: ConfigService,
  ) {
    this.toolDeps = {
      messagesService,
      couponsService,
      scheduleHealthService,
    }
  }

  /** 创建会话 */
  async createConversation(userId: string, scenario: string, title?: string, metadata?: any) {
    // 找一个匹配 scenario 的 Agent
    const agent = await this.prisma.agent.findFirst({
      where: { scenario, status: 'ACTIVE' },
    })
    if (!agent) {
      throw new NotFoundException(`未找到 scenario=${scenario} 的可用智能体`)
    }
    const conv = await this.prisma.agentConversation.create({
      data: {
        convNo: generateOrderNo('CONV'),
        agentId: agent.id,
        userId,
        scenario,
        title: title ?? `${scenario} 智能助手会话`,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })
    // 写入系统欢迎消息
    await this.prisma.agentMessage.create({
      data: {
        convId: conv.id,
        role: AGENT_ROLE_SYSTEM,
        content: this.welcomeMessage(scenario),
      },
    })
    return conv
  }

  /** 关闭会话 */
  async closeConversation(convId: string, summary?: string) {
    const conv = await this.prisma.agentConversation.findUnique({
      where: { id: convId },
    })
    if (!conv) throw new NotFoundException('会话不存在')
    if (conv.status !== 'ACTIVE') {
      throw new BadRequestException('会话已关闭')
    }
    return this.prisma.agentConversation.update({
      where: { id: convId },
      data: { status: 'CLOSED', summary, closedAt: new Date() },
    })
  }

  /** 查询会话列表 */
  async listConversations(userId: string, scenario?: string) {
    return this.prisma.agentConversation.findMany({
      where: {
        userId,
        ...(scenario ? { scenario } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true, convNo: true, scenario: true, title: true,
        status: true, summary: true, createdAt: true, updatedAt: true,
      },
    })
  }

  /** 查询会话历史消息 */
  async listMessages(convId: string, limit = 50) {
    return this.prisma.agentMessage.findMany({
      where: { convId },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 200),
    })
  }

  /**
   * 核心方法：发送用户消息并获取 AI 回复
   * 流程：
   *  1. 写入用户消息
   *  2. 加载会话历史 + 工具列表
   *  3. 调用 LLM
   *  4. 处理工具调用（资金类写 PENDING_CONFIRM 日志）
   *  5. 写入 AI 回复
   *  6. 返回结果
   */
  async sendMessage(input: {
    convId: string
    content: string
    user: AgentCurrentUser
  }): Promise<{ reply: string; toolCalls?: any[]; pendingOps?: any[] }> {
    const conv = await this.prisma.agentConversation.findUnique({
      where: { id: input.convId },
    })
    if (!conv) throw new NotFoundException('会话不存在')
    if (conv.status !== 'ACTIVE') {
      throw new BadRequestException('会话已关闭')
    }

    // 写入用户消息
    await this.prisma.agentMessage.create({
      data: { convId: conv.id, role: AGENT_ROLE_USER, content: input.content },
    })

    // 加载历史
    const history = await this.prisma.agentMessage.findMany({
      where: { convId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: 30,
      select: { role: true, content: true, toolCalls: true },
    })

    // 加载工具
    const tools = this.toolRegistry.getTools(input.user, conv.scenario, this.toolDeps)

    // 构造 system prompt
    const systemPrompt = this.buildSystemPrompt(conv.scenario, input.user)

    // 调用 LLM
    const messages: LlmMessage[] = history.map((h) => ({
      role: (h.role.toLowerCase() === 'assistant' ? 'assistant' :
            h.role.toLowerCase() === 'tool' ? 'tool' :
            h.role.toLowerCase() === 'system' ? 'system' : 'user') as any,
      content: h.content,
    }))

    const llmResult = await this.llm.chat({
      messages,
      tools,
      systemPrompt,
      maxSteps: MAX_TURNS,
    })

    // 处理需要确认的工具调用
    const pendingOps: any[] = []
    if (llmResult.toolCalls) {
      for (const tc of llmResult.toolCalls) {
        const tool = tools.find((t) => t.name === tc.name)
        if (tool?.requireConfirm) {
          // 写入待确认日志
          const opLog = await this.auditLog.log({
            agentId: input.user.sub,
            subjectType: input.user.subjectType ?? 'user',
            subjectId: input.user.subjectId ?? conv.userId,
            action: tc.name,
            scope: tc.name,
            amount: tc.args?.amountYuan ? Math.round(tc.args.amountYuan * 100) : null,
            result: AGENT_RESULT_PENDING_CONFIRM,
            detail: { args: tc.args, convId: conv.id },
          })
          pendingOps.push({
            opLogId: opLog.id,
            toolName: tc.name,
            args: tc.args,
            message: `操作待确认：${tc.name}`,
          })
          // 通知用户
          await this.messagesService.sendMessage({
            userId: conv.userId,
            category: 'SYSTEM',
            title: '智能体操作待确认',
            content: `智能体请求执行 ${tc.name}，操作详情：${JSON.stringify(tc.args)}。请在 ${this.configService.get('AGENT_CONFIRM_TIMEOUT_SEC', 60)} 秒内确认。`,
            channels: 'IN_APP',
            priority: 'HIGH',
          })
        }
      }
    }

    // 写入 AI 回复
    await this.prisma.agentMessage.create({
      data: {
        convId: conv.id,
        role: AGENT_ROLE_ASSISTANT,
        content: llmResult.content,
        toolCalls: llmResult.toolCalls ? JSON.stringify(llmResult.toolCalls) : null,
        model: llmResult.model,
        tokens: llmResult.tokens,
      },
    })

    // 更新会话时间戳
    await this.prisma.agentConversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    })

    return {
      reply: llmResult.content,
      toolCalls: llmResult.toolCalls,
      pendingOps: pendingOps.length > 0 ? pendingOps : undefined,
    }
  }

  /**
   * 确认或拒绝待确认的操作
   * - CONFIRM：执行工具，更新日志为 SUCCESS
   * - REJECT：更新日志为 REJECTED
   */
  async confirmOp(input: {
    opLogId: string
    decision: 'CONFIRM' | 'REJECT'
    user: AgentCurrentUser
  }): Promise<{ success: boolean; result?: any; message: string }> {
    const opLog = await this.prisma.agentOperationLog.findUnique({
      where: { id: input.opLogId },
    })
    if (!opLog) throw new NotFoundException('操作记录不存在')
    if (opLog.result !== AGENT_RESULT_PENDING_CONFIRM) {
      throw new BadRequestException('操作已处理')
    }

    if (input.decision === 'REJECT') {
      await this.prisma.agentOperationLog.update({
        where: { id: input.opLogId },
        data: { result: AGENT_RESULT_REJECTED },
      })
      return { success: false, message: '操作已拒绝' }
    }

    // CONFIRM：执行工具
    const detail = opLog.detail ? JSON.parse(opLog.detail) : {}
    const tools = this.toolRegistry.getTools(input.user, opLog.scope.split(':')[0] as any, this.toolDeps)
    const tool = tools.find((t) => t.name === opLog.action)
    if (!tool) {
      throw new BadRequestException(`工具 ${opLog.action} 不存在`)
    }

    try {
      const result = await tool.execute(detail.args ?? {})
      // 更新日志为 SUCCESS（保持原 hash 不变，追加结果记录）
      await this.prisma.agentOperationLog.update({
        where: { id: input.opLogId },
        data: {
          result: AGENT_RESULT_SUCCESS,
          detail: JSON.stringify({ ...detail, result }),
        },
      })
      return { success: true, result, message: '操作执行成功' }
    } catch (err: any) {
      await this.prisma.agentOperationLog.update({
        where: { id: input.opLogId },
        data: { result: 'FAILED', detail: JSON.stringify({ ...detail, error: err.message }) },
      })
      throw err
    }
  }

  /** 校验 Agent 哈希链 */
  async verifyHashChain(agentId: string): Promise<{ valid: boolean; brokenAt?: string }> {
    const brokenAt = await this.auditLog.verifyChain(agentId)
    return { valid: brokenAt === null, brokenAt: brokenAt ?? undefined }
  }

  private buildSystemPrompt(scenario: string, user: AgentCurrentUser): string {
    const base = `你是 KeBaiPay 智能支付平台的 AI 助手，当前场景：${scenario}。
你的职责是帮助用户完成支付相关的操作。
- 当前用户 ID：${user.subjectId ?? '未知'}
- 你的 Agent ID：${user.sub}
- 你的权限范围：${(user.authScopes ?? user.scopes ?? []).join(', ')}

规则：
1. 资金类操作（转账、退款、发红包等）必须先告知用户金额和对象，等待用户确认后才执行
2. 查询类操作可以直接执行
3. 不要编造数据，调用工具获取真实数据
4. 如果工具执行失败，告诉用户原因并建议下一步
5. 用简洁友好的中文回答，金额用元表示（不是分）`

    if (scenario === 'wallet') {
      return base + `\n\n场景说明：钱包管家，帮助 C 端用户管理钱包、查账单、转账、发红包、领优惠券等。`
    } else if (scenario === 'merchant') {
      return base + `\n\n场景说明：店长助理，帮助 B 端商户查询订单、对账、退款、营销等。`
    } else if (scenario === 'risk') {
      return base + `\n\n场景说明：风控审计官，监控风险事件、巡检系统健康、处理对账差异。`
    } else if (scenario === 'support') {
      return base + `\n\n场景说明：客服坐席，解答用户疑问并转交专业 Agent。`
    }
    return base
  }

  private welcomeMessage(scenario: string): string {
    const map: Record<string, string> = {
      wallet: '您好，我是钱包管家，可以帮您查询余额、转账、发红包、推荐优惠券等。',
      merchant: '您好，我是店长助理，可以帮您查询订单、对账、营销等。',
      risk: '您好，我是风控审计官，正在监控风险事件和系统健康。',
      support: '您好，我是客服助手，有什么可以帮您？',
    }
    return map[scenario] ?? '您好，我是智能助手。'
  }
}
