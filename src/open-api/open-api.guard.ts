import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { AppStatus } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { OpenApiRequest } from './open-api.types'

/**
 * 开放 API 签名守卫
 *
 * 签名基线（客户端按此构造）：
 *   HMAC-SHA256(appSecret, `${method}\n${path}\n${rawBody}\n${timestamp}\n${nonce}\n${appId}`)
 *
 * nonce 默认写入 Redis；Redis 未配置时降级为进程内 Map。
 */
@Injectable()
export class OpenApiGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Redis 未配置时降级到进程内缓存
  private nonceCache = new Map<string, number>()
  // 请求有效时间窗：过去 120 秒 ~ 未来 30 秒
  private readonly TIMESTAMP_WINDOW_MS = 2 * 60 * 1000
  private readonly TIMESTAMP_FUTURE_MS = 30 * 1000
  // nonce 缓存保留时间
  private readonly NONCE_TTL_MS = 2 * 60 * 1000

  private nonceKey(nonce: string) {
    return `openapi:nonce:${nonce}`
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OpenApiRequest>()
    const appId = request.headers['x-app-id'] as string | undefined
    const timestamp = request.headers['x-timestamp'] as string | undefined
    const nonce = request.headers['x-nonce'] as string | undefined
    const signature = request.headers['x-signature'] as string | undefined

    if (!appId || !timestamp || !nonce || !signature) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '缺少签名参数'))
    }

    const ts = Number(timestamp)
    if (Number.isNaN(ts)) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '时间戳无效'))
    }

    const now = Date.now()
    if (ts < now - this.TIMESTAMP_WINDOW_MS || ts > now + this.TIMESTAMP_FUTURE_MS) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '请求已过期或时间戳异常'))
    }

    const app = await this.prisma.merchantApp.findUnique({
      where: { appId },
    })
    if (!app) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_APP_NOT_FOUND))
    }
    if (app.status !== AppStatus.ACTIVE) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_APP_DISABLED))
    }

    const method = request.method.toUpperCase()
    const path = request.path
    const rawBody = this.getRawBody(request)

    const signString = `${method}\n${path}\n${rawBody}\n${timestamp}\n${nonce}\n${appId}`
    const expectedSignature = createHmac('sha256', app.appSecret)
      .update(signString)
      .digest('hex')

    // 先比较长度，不等直接 401，避免 timingSafeEqual 抛 RangeError 导致 500
    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '签名无效'))
    }
    if (!timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '签名无效'))
    }

    // 验签通过后原子性地判重放并标记 nonce
    const isNew = await this.checkAndMarkNonce(
      nonce as string,
      Math.ceil(this.NONCE_TTL_MS / 1000),
    )
    if (!isNew) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, 'nonce 已使用'))
    }

    ;(request as OpenApiRequest).merchantApp = app
    return true
  }

  /**
   * 原子性地检查并标记 nonce：返回 true 表示新 nonce，false 表示重放。
   * Redis 可用时使用 SET NX（原子 set-if-not-exists），避免 check+mark 之间的竞态。
   */
  private async checkAndMarkNonce(
    nonce: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.redis.isEnabled()) {
      // Redis 未配置时降级到进程内缓存
      const now = Date.now()
      const expiry = this.nonceCache.get(nonce)
      if (expiry && expiry > now) {
        return false // 重放
      }
      this.nonceCache.set(nonce, now + ttlSeconds * 1000)
      return true
    }
    // 原子操作：尝试获取以 nonce 为 key 的锁，成功则为新 nonce，失败则为重放
    return this.redis.acquireLock(this.nonceKey(nonce), ttlSeconds, '1')
  }

  private getRawBody(request: OpenApiRequest): string {
    if (Buffer.isBuffer(request.rawBody)) {
      return request.rawBody.toString('utf8')
    }
    if (typeof request.rawBody === 'string') {
      return request.rawBody
    }
    return ''
  }
}
