import { ConfigService } from '@nestjs/config'

/**
 * LLM 配置：
 * - LLM_PROVIDER=mock 时降级到本地模板，零外部依赖
 * - 其他 provider 走 OpenAI 兼容协议（DeepSeek/通义/Kimi/Moonshot 等）
 *
 * 注意：dotenv 加载的环境变量都是 string，必须显式转换为 number，
 * 否则 AbortSignal.timeout() 等原生 API 会抛 ERR_INVALID_ARG_TYPE。
 */
export interface LlmConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
  maxTokens: number
  temperature: number
}

function toNumber(v: any, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function loadLlmConfig(config: ConfigService): LlmConfig {
  return {
    provider: config.get<string>('LLM_PROVIDER', 'mock') as string,
    apiKey: (config.get<string>('LLM_API_KEY', '') as string) ?? '',
    baseUrl: (config.get<string>('LLM_BASE_URL', 'https://api.deepseek.com') as string) ?? 'https://api.deepseek.com',
    model: (config.get<string>('LLM_MODEL', 'deepseek-chat') as string) ?? 'deepseek-chat',
    timeoutMs: toNumber(config.get('LLM_TIMEOUT_MS'), 30000),
    maxTokens: toNumber(config.get('LLM_MAX_TOKENS'), 2000),
    temperature: toNumber(config.get('LLM_TEMPERATURE'), 0.3),
  }
}
