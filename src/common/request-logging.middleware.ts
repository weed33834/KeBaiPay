import { Injectable, NestMiddleware, Logger } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

/**
 * 请求日志中间件：为每个请求注入链路追踪 ID 并记录请求/响应摘要。
 * traceId 优先复用上游传入的 X-Request-Id，否则生成 UUID。
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

    res.on('finish', () => {
      const duration = Date.now() - startTime
      const { statusCode } = res
      // 5xx 记录为 error，4xx 记录为 warn，其余为 log
      if (statusCode >= 500) {
        this.logger.error(`[${traceId}] ${method} ${originalUrl} ${statusCode} ${duration}ms ${ip}`)
      } else if (statusCode >= 400) {
        this.logger.warn(`[${traceId}] ${method} ${originalUrl} ${statusCode} ${duration}ms ${ip}`)
      } else {
        this.logger.log(`[${traceId}] ${method} ${originalUrl} ${statusCode} ${duration}ms`)
      }
    })

    next()
  }
}
