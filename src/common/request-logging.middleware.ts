import { Injectable, NestMiddleware, Logger } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { runWithTraceId } from './trace-context'

/**
 * 请求日志中间件：为每个请求注入链路追踪 ID 并记录请求/响应摘要。
 * traceId 优先复用上游传入的 X-Request-Id，否则生成 UUID。
 * 通过 runWithTraceId 将 traceId 注入 AsyncLocalStorage，使 service 层
 * Logger 自动带 [traceId] 前缀，便于全链路日志关联排查。
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP')

  use(req: Request, res: Response, next: NextFunction) {
    const traceId = (req.headers['x-request-id'] as string) || randomUUID()
    req.headers['x-request-id'] = traceId
    res.setHeader('X-Request-Id', traceId)

    const { method, originalUrl, ip } = req
    const startTime = Date.now()

    // res.on('finish') 在请求结束时触发，此时 ALS 上下文可能已退出，
    // 用闭包捕获 traceId 而非依赖 getTraceId()
    res.on('finish', () => {
      const duration = Date.now() - startTime
      const { statusCode } = res
      if (statusCode >= 500) {
        this.logger.error(`[${traceId}] ${method} ${originalUrl} ${statusCode} ${duration}ms ${ip}`)
      } else if (statusCode >= 400) {
        this.logger.warn(`[${traceId}] ${method} ${originalUrl} ${statusCode} ${duration}ms ${ip}`)
      } else {
        this.logger.log(`[${traceId}] ${method} ${originalUrl} ${statusCode} ${duration}ms`)
      }
    })

    // 用 AsyncLocalStorage 包装后续处理链，service 层 Logger 可自动取到 traceId
    runWithTraceId(traceId, () => next())
  }
}
