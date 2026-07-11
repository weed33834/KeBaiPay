import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
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

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
