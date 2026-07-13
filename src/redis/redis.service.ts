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

// 滑动窗口限流 Lua 脚本：ZSET 实现毫秒级精度，先清理过期成员再判断
// KEYS[1] = ZSET key
// ARGV[1] = now (毫秒)
// ARGV[2] = window (毫秒)
// ARGV[3] = limit
// ARGV[4] = member (唯一标识，避免同一请求重复计入)
// 返回 1 = 允许通过并已记录，0 = 已达上限拒绝
const SLIDING_WINDOW_CHECK_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return 1
`

// 滑动窗口计数 Lua 脚本：仅读取当前窗口内成员数，不写入
// KEYS[1] = ZSET key
// ARGV[1] = now (毫秒)
// ARGV[2] = window (毫秒)
// 返回当前窗口内成员数
const SLIDING_WINDOW_COUNT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
return redis.call('ZCARD', key)
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

  /**
   * 原子限流：SET key value NX EX ttl
   * 成功返回 true（首次设置），失败返回 false（key 已存在，限流生效）
   * 用于"60秒内只能发一次"这类固定窗口限流
   */
  async setRateLimit(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) {
      // 开发环境无 Redis 时降级为进程内实现
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Redis 未配置，限流不可用。生产环境必须配置 REDIS_URL。')
      }
      this.logger.warn(`开发环境无 Redis，限流降级为进程内: ${key}`)
      return true
    }
    const result = await this.ensureClient().set(key, '1', 'EX', ttlSeconds, 'NX')
    return result === 'OK'
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

  /**
   * 滑动窗口限流（原子检查并记录）
   *
   * 基于 Redis ZSET 实现：score 存放请求时间戳，member 存放唯一标识。
   * 每次调用先清理过期成员，再判断当前窗口内数量是否超限。
   *
   * @param key ZSET key
   * @param windowMs 窗口大小（毫秒）
   * @param limit 窗口内允许的最大请求数
   * @param member 唯一成员标识（用于 ZADD，建议使用 nanosecond 时间戳 + 随机数防重复）
   * @returns true=放行（已记录），false=拒绝（已达上限）
   */
  async slidingWindowCheck(
    key: string,
    windowMs: number,
    limit: number,
    member: string,
  ): Promise<boolean> {
    if (!this.client) {
      // 风控场景下 Redis 不可用必须 fail-closed，由调用方处理异常
      throw new Error(`Redis 未配置，滑动窗口限流不可用: ${key}`)
    }
    const now = Date.now()
    const result = await this.ensureClient().eval(
      SLIDING_WINDOW_CHECK_SCRIPT,
      1,
      key,
      String(now),
      String(windowMs),
      String(limit),
      member,
    )
    return Number(result) === 1
  }

  /**
   * 滑动窗口计数（仅读取，不写入）
   *
   * 查询当前窗口内已记录的成员数，用于 recordTransaction 后查询当前已发生次数。
   * 清理过期成员后返回 ZCARD。
   *
   * @param key ZSET key
   * @param windowMs 窗口大小（毫秒）
   * @returns 当前窗口内成员数
   */
  async slidingWindowCount(key: string, windowMs: number): Promise<number> {
    if (!this.client) {
      throw new Error(`Redis 未配置，滑动窗口计数不可用: ${key}`)
    }
    const now = Date.now()
    const result = await this.ensureClient().eval(
      SLIDING_WINDOW_COUNT_SCRIPT,
      1,
      key,
      String(now),
      String(windowMs),
    )
    return Number(result)
  }

  /**
   * 滑动窗口记录（仅写入，不检查）
   *
   * 用于 recordTransaction：交易成功后追加一条记录到 ZSET，TTL 自动过期。
   * 使用 nanosecond 时间戳 + 随机数作为 member，避免同一秒内多次交易相互覆盖。
   *
   * @param key ZSET key
   * @param windowMs 窗口大小（毫秒），用作 TTL 上限
   * @param member 唯一成员标识
   */
  async slidingWindowRecord(
    key: string,
    windowMs: number,
    member: string,
  ): Promise<void> {
    if (!this.client) {
      throw new Error(`Redis 未配置，滑动窗口记录不可用: ${key}`)
    }
    const client = this.ensureClient()
    const now = Date.now()
    // 使用 pipeline 减少往返：清理过期 + ZADD + PEXPIRE
    await client
      .multi()
      .zremrangebyscore(key, 0, now - windowMs)
      .zadd(key, now, member)
      .pexpire(key, windowMs)
      .exec()
  }
}
