import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { Observable, map } from 'rxjs'

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'hashedPassword',
  'hashed_password',
  'appSecret',
  'app_secret',
  'secret',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'privateKey',
  'private_key',
  'encryptionKey',
  'encryption_key',
  'salt',
  'verificationCode',
  'verification_code',
])

/**
 * 响应转换拦截器
 *
 * 响应格式约定（见 src/common/api-response.ts）：
 * - 成功响应：body 直接返回业务数据（脱敏敏感字段后），不包裹 envelope
 * - 异常响应：由 AllExceptionsFilter 构造 ApiErrorResponse envelope
 * - X-Request-Id header 由 RequestLoggingMiddleware 设置，所有响应都带
 */
@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>()
    const res = context.switchToHttp().getResponse<Response>()
    // 确保响应头带 X-Request-Id（middleware 已设置，此处防御性确保异常路径外的所有响应都有）
    const traceId = req.headers['x-request-id'] as string | undefined
    if (traceId) {
      res.setHeader('X-Request-Id', traceId)
    }
    // 健康检查端点返回原始结构，k8s/docker probe 依赖 status 字段与状态码判断
    if (req.path.startsWith('/health')) {
      return next.handle()
    }
    return next.handle().pipe(
      map((data) => this.stripSensitiveFields(data)),
    )
  }

  private stripSensitiveFields(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.stripSensitiveFields(item))
    }

    if (typeof data === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (SENSITIVE_FIELDS.has(key)) {
          result[key] = '[REDACTED]'
        } else {
          result[key] = this.stripSensitiveFields(value)
        }
      }
      return result
    }

    return data
  }
}
