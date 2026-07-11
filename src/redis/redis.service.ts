import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

// 原子释放锁的 Lua 脚本：仅当锁值匹配时才删除，防止误释放他人锁
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`

// 原子 incr + expire 的 Lua 脚本：首次 incr 时设置 TTL，防止进程崩溃后 key 永驻
const INCR_WITH_EXPIRE_SCRIPT = `
local value = redis.call('incr', KEYS[1])
if value == 1 then
  redis.call('expire', KEYS[1], ARGV[1])
end
return value
`

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private client: Redis | null = null

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL')
    if (!url) {
      // 允许无 Redis 的本地开发/测试环境，降级为内存实现
      this.logger.warn('REDIS_URL 未配置，分布式锁与缓存将降级为进程内实现。生产环境必须配置 Redis。')
      return
    }
    this.client = new Redis(url, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    })
    this.client.on('error', (err) => {
      this.logger.error(`Redis 错误: ${err.message}`)
    })
    this.client.on('connect', () => {
      this.logger.log('Redis 已连接')
    })
    this.client.on('reconnecting', () => {
      this.logger.warn('Redis 正在重连...')
    })
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect()
    }
  }

  private ensureClient() {
    if (!this.client) {
      throw new Error('Redis 未配置')
    }
    return this.client
  }

  /**
   * 生产环境未配置 Redis 时抛错，开发环境静默降级
   * 资金类操作（如 acquireLock）始终抛错，不在此处降级
   */
  private ensureClientOrThrow(methodName: string): void | never {
    if (this.client) return
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Redis 未配置，生产环境 ${methodName} 不可降级。请配置 REDIS_URL`)
    }
  }

  isEnabled(): boolean {
    return this.client !== null
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      this.ensureClientOrThrow('get')
      return null
    }
    return this.ensureClient().get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) {
      this.ensureClientOrThrow('set')
      return
    }
    if (ttlSeconds) {
      await this.ensureClient().setex(key, ttlSeconds, value)
    } else {
      await this.ensureClient().set(key, value)
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) {
      this.ensureClientOrThrow('del')
      return
    }
    await this.ensureClient().del(key)
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false
    const result = await this.ensureClient().exists(key)
    return result === 1
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.client) return
    await this.ensureClient().expire(key, ttlSeconds)
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.client) {
      this.ensureClientOrThrow('incr')
      return 0
    }
    const client = this.ensureClient()
    if (ttlSeconds) {
      // 使用 Lua 脚本保证 incr 和 expire 原子性，防止进程崩溃后 key 无 TTL 永驻
      const result = await client.eval(INCR_WITH_EXPIRE_SCRIPT, 1, key, String(ttlSeconds))
      return Number(result)
    }
    return client.incr(key)
  }

  async decr(key: string): Promise<number> {
    if (!this.client) return 0
    return this.ensureClient().decr(key)
  }

  async getTtl(key: string): Promise<number> {
    if (!this.client) return -2
    return this.ensureClient().ttl(key)
  }

  /** 健康检查用：返回 PONG 表示连接正常 */
  async ping(): Promise<string> {
    if (!this.client) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Redis 未配置，生产环境必须配置 REDIS_URL')
      }
      return 'PONG' // 开发环境降级，允许无 Redis 运行
    }
    return this.ensureClient().ping()
  }

  /**
   * 尝试获取分布式锁
   * 生产环境无 Redis 时抛错，开发环境静默放行（降级为无锁）
   * @returns 是否获取成功
   */
  async acquireLock(lockKey: string, ttlSeconds: number, identifier?: string): Promise<boolean> {
    if (!this.client) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Redis 未配置，分布式锁不可用。资金类操作要求 Redis 必须可用。')
      }
      this.logger.warn(`开发环境无 Redis，跳过锁获取: ${lockKey}`)
      return true
    }
    const token = identifier || `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const result = await this.ensureClient().set(lockKey, token, 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  }

  /**
   * 释放分布式锁（原子操作：仅当值匹配时才释放，防止误释放他人锁）
   * 使用 Lua 脚本保证 GET + DEL 的原子性
   */
  async releaseLock(lockKey: string, identifier?: string): Promise<void> {
    if (!this.client) return
    const client = this.ensureClient()
    if (identifier) {
      await client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, identifier)
    } else {
      await client.del(lockKey)
    }
  }

  /**
   * 带锁执行函数，自动获取与释放
   * 开发环境无 Redis 时直接执行 fn()（降级为无锁）
   */
  async withLock<T>(
    lockKey: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
    identifier?: string,
  ): Promise<T> {
    if (!this.client) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Redis 未配置，分布式锁不可用。资金类操作要求 Redis 必须可用。')
      }
      this.logger.warn(`开发环境无 Redis，跳过锁执行: ${lockKey}`)
      return fn()
    }
    const token = identifier || `lock:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const acquired = await this.acquireLock(lockKey, ttlSeconds, token)
    if (!acquired) {
      throw new Error(`获取锁失败: ${lockKey}`)
    }
    try {
      return await fn()
    } finally {
      await this.releaseLock(lockKey, token)
    }
  }
}
