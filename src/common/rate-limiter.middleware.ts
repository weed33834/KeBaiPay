import { Injectable, NestMiddleware, Logger } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'

interface RateLimitEntry {
  count: number
  resetTime: number
}

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private readonly logger = new Logger('RateLimiter')
  private readonly globalStore = new Map<string, RateLimitEntry>()
  private readonly authStore = new Map<string, RateLimitEntry>()
  private readonly openApiStore = new Map<string, RateLimitEntry>()

  private readonly GLOBAL_LIMIT = 100
  private readonly GLOBAL_TTL_MS = 60 * 1000

  private readonly AUTH_LIMIT = 10
  private readonly AUTH_TTL_MS = 60 * 1000

  private readonly OPEN_API_LIMIT = 30
  private readonly OPEN_API_TTL_MS = 60 * 1000

  private readonly CLEANUP_INTERVAL_MS = 60 * 1000

  constructor() {
    setInterval(() => {
      this.cleanupExpired(this.globalStore, this.GLOBAL_TTL_MS)
      this.cleanupExpired(this.authStore, this.AUTH_TTL_MS)
      this.cleanupExpired(this.openApiStore, this.OPEN_API_TTL_MS)
    }, this.CLEANUP_INTERVAL_MS)
  }

  use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const path = req.path

    if (path.startsWith('/auth')) {
      if (!this.checkRateLimit(this.authStore, `auth:${ip}`, this.AUTH_LIMIT, this.AUTH_TTL_MS)) {
        res.setHeader('Retry-After', String(Math.ceil(this.AUTH_TTL_MS / 1000)))
        return res.status(429).json({
          statusCode: 429,
          message: '认证请求过于频繁，请稍后再试',
          error: 'Too Many Requests',
        })
      }
    }

    if (path.startsWith('/open-api')) {
      const appId = (req.headers['x-app-id'] as string) || ip
      if (!this.checkRateLimit(this.openApiStore, `openapi:${appId}`, this.OPEN_API_LIMIT, this.OPEN_API_TTL_MS)) {
        res.setHeader('Retry-After', String(Math.ceil(this.OPEN_API_TTL_MS / 1000)))
        return res.status(429).json({
          statusCode: 429,
          message: '开放 API 请求过于频繁，请稍后再试',
          error: 'Too Many Requests',
        })
      }
    }

    if (!this.checkRateLimit(this.globalStore, `global:${ip}`, this.GLOBAL_LIMIT, this.GLOBAL_TTL_MS)) {
      res.setHeader('Retry-After', String(Math.ceil(this.GLOBAL_TTL_MS / 1000)))
      return res.status(429).json({
        statusCode: 429,
        message: '请求过于频繁，请稍后再试',
        error: 'Too Many Requests',
      })
    }

    next()
  }

  private checkRateLimit(
    store: Map<string, RateLimitEntry>,
    key: string,
    limit: number,
    ttlMs: number,
  ): boolean {
    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now > entry.resetTime) {
      store.set(key, { count: 1, resetTime: now + ttlMs })
      return true
    }

    if (entry.count >= limit) {
      return false
    }

    entry.count++
    return true
  }

  private cleanupExpired(store: Map<string, RateLimitEntry>, ttlMs: number) {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetTime + ttlMs) {
        store.delete(key)
      }
    }
  }
}
