import { ConfigService } from '@nestjs/config'

/**
 * LLM 配置：
 * - LLM_PROVIDER=mock 时降级到本地模板，零外部依赖
 * - 其他 provider 走 OpenAI 兼容协议（DeepSeek/通义/Kimi/Moonshot 等）
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

export function loadLlmConfig(config: ConfigService): LlmConfig {
  return {
    provider: config.get<string>('LLM_PROVIDER', 'mock'),
    apiKey: config.get<string>('LLM_API_KEY', ''),
    baseUrl: config.get<string>('LLM_BASE_URL', 'https://api.deepseek.com'),
    model: config.get<string>('LLM_MODEL', 'deepseek-chat'),
    timeoutMs: config.get<number>('LLM_TIMEOUT_MS', 30000),
    maxTokens: config.get<number>('LLM_MAX_TOKENS', 2000),
    temperature: config.get<number>('LLM_TEMPERATURE', 0.3),
  }
}
