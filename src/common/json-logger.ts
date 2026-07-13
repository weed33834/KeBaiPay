import { LoggerService, LogLevel } from '@nestjs/common'
import { getTraceId } from './trace-context'

/**
 * 结构化 JSON 日志
 *
 * 生产环境输出 JSON 行，便于 ELK/Loki 等日志系统解析与检索；
 * 开发环境回退到 NestJS 默认文本格式（彩色、可读）。
 *
 * 每条日志包含：
 * - timestamp: ISO8601 时间戳
 * - level: DEBUG/INFO/WARN/ERROR
 * - context: logger 实例名（通常是 service 类名）
 * - message: 日志消息
 * - traceId: 链路 ID（来自 AsyncLocalStorage，无则省略）
 * - 可选 extra: 错误 stack 等附加信息
 *
 * 不依赖 pino/winston：保持依赖最小，使用 NestJS LoggerService 接口。
 */
export class JsonLogger implements LoggerService {
  private readonly isProduction = process.env.NODE_ENV === 'production'
  // 不能 readonly：setLogLevels 会重新赋值
  private enabledLevels: Set<LogLevel>

  constructor(
    private readonly context: string = 'App',
    levels?: LogLevel[],
  ) {
    // 默认全开；可由 NestFactory.create({ logger: levels }) 限制
    this.enabledLevels = new Set(levels ?? ['log', 'error', 'warn', 'debug', 'verbose'])
  }

  log(message: unknown, context?: string): void {
    this.emit('log', message, context)
  }

  error(message: unknown, trace?: unknown, context?: string): void {
    this.emit('error', message, context, trace)
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, context)
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, context)
  }

  verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context)
  }

  fatal(message: unknown, context?: string): void {
    this.emit('error', message, context)
  }

  setLogLevels?(levels: LogLevel[]): void {
    this.enabledLevels = new Set(levels)
  }

  private emit(level: LogLevel, message: unknown, context?: string, trace?: unknown): void {
    if (!this.enabledLevels.has(level)) return

    const ctx = context || this.context
    const traceId = getTraceId()

    if (this.isProduction) {
      // 生产：JSON 行，便于日志采集器解析
      const line: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        context: ctx,
        message: this.normalize(message),
      }
      if (traceId) line.traceId = traceId
      if (trace instanceof Error) {
        line.stack = trace.stack
      } else if (typeof trace === 'string' && trace.length > 0) {
        line.stack = trace
      }
      process.stdout.write(JSON.stringify(line) + '\n')
      return
    }

    // 开发：保持可读文本，便于本地调试
    const tracePrefix = traceId ? `[${traceId}] ` : ''
    const msg = this.normalize(message)
    const stack = trace instanceof Error ? trace.stack : typeof trace === 'string' ? trace : ''
    const formatted = stack ? `${tracePrefix}${msg}\n${stack}` : `${tracePrefix}${msg}`
    // 用 NestJS 颜色约定粗略对应
    const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[32m'
    process.stdout.write(`${color}[${ctx}]\x1b[0m ${level.toUpperCase()} ${formatted}\n`)
  }

  private normalize(msg: unknown): string {
    if (typeof msg === 'string') return msg
    if (msg instanceof Error) return msg.message
    try {
      return JSON.stringify(msg)
    } catch {
      return String(msg)
    }
  }
}
