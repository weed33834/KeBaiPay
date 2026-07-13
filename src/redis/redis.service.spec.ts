import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { RedisService } from './redis.service'

// mock ioredis：默认导出构造函数为 jest.fn()，由各用例通过 mockImplementation 返回自定义 client
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const MockedRedis = Redis as unknown as jest.Mock

type RedisClientMock = {
  get: jest.Mock
  set: jest.Mock
  setex: jest.Mock
  del: jest.Mock
  exists: jest.Mock
  expire: jest.Mock
  eval: jest.Mock
  incr: jest.Mock
  decr: jest.Mock
  ttl: jest.Mock
  ping: jest.Mock
  disconnect: jest.Mock
  on: jest.Mock
  multi: jest.Mock
}

describe('RedisService', () => {
  let service: RedisService
  let configService: { get: jest.Mock }
  let client: RedisClientMock

  // 用指定 REDIS_URL（undefined 表示不配置）创建服务并触发 onModuleInit
  const createService = async (redisUrl: string | undefined): Promise<void> => {
    configService = {
      get: jest.fn((key: string) => (key === 'REDIS_URL' ? redisUrl : undefined)),
    }
    client = {
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      eval: jest.fn(),
      incr: jest.fn(),
      decr: jest.fn(),
      ttl: jest.fn(),
      ping: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
      multi: jest.fn(),
    }
    MockedRedis.mockImplementation(() => client)

    const module = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile()
    service = module.get(RedisService)
    // compile() 不会触发生命周期钩子，显式调用 onModuleInit 以创建/不创建 client
    await service.onModuleInit()
  }

  describe('isEnabled', () => {
    it('有 client 时返回 true', async () => {
      await createService('redis://localhost:6379')
      expect(service.isEnabled()).toBe(true)
    })

    it('无 client 时返回 false', async () => {
      await createService(undefined)
      expect(service.isEnabled()).toBe(false)
    })
  })

  describe('无 Redis 配置时降级', () => {
    it('get 返回 null', async () => {
      await createService(undefined)
      expect(await service.get('any-key')).toBeNull()
    })

    it('set 不抛错（静默跳过）', async () => {
      await createService(undefined)
      await expect(service.set('k', 'v')).resolves.toBeUndefined()
      await expect(service.set('k', 'v', 60)).resolves.toBeUndefined()
    })

    it('非生产环境 acquireLock 降级返回 true', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      await createService(undefined)
      await expect(service.acquireLock('lock:order:1', 30)).resolves.toBe(true)
      process.env.NODE_ENV = originalEnv
    })

    it('生产环境 acquireLock 抛错', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      await createService(undefined)
      await expect(service.acquireLock('lock:order:1', 30)).rejects.toThrow(
        'Redis 未配置，分布式锁不可用。资金类操作要求 Redis 必须可用。',
      )
      process.env.NODE_ENV = originalEnv
    })

    it('非生产环境 withLock 降级直接执行函数', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      await createService(undefined)
      const fn = jest.fn(async () => 'degraded-result')
      const result = await service.withLock('lock:order:1', 30, fn)
      expect(result).toBe('degraded-result')
      expect(fn).toHaveBeenCalledTimes(1)
      process.env.NODE_ENV = originalEnv
    })

    it('生产环境 withLock 抛错', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      await createService(undefined)
      const fn = jest.fn(async () => 'should-not-run')
      await expect(service.withLock('lock:order:1', 30, fn)).rejects.toThrow(
        'Redis 未配置，分布式锁不可用。资金类操作要求 Redis 必须可用。',
      )
      expect(fn).not.toHaveBeenCalled()
      process.env.NODE_ENV = originalEnv
    })
  })

  describe('ping', () => {
    it('有 client 时返回真实 PONG', async () => {
      await createService('redis://localhost:6379')
      client.ping.mockResolvedValue('PONG')
      expect(await service.ping()).toBe('PONG')
      expect(client.ping).toHaveBeenCalledTimes(1)
    })

    it('无 client 时降级返回 PONG（不调用 client）', async () => {
      await createService(undefined)
      expect(await service.ping()).toBe('PONG')
    })
  })

  describe('acquireLock', () => {
    it('成功获取锁返回 true 并以 EX NX 写入', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue('OK')

      const ok = await service.acquireLock('lock:order:1', 30, 'token-abc')

      expect(ok).toBe(true)
      expect(client.set).toHaveBeenCalledWith(
        'lock:order:1',
        'token-abc',
        'EX',
        30,
        'NX',
      )
    })

    it('锁已被占用（set 返回 null）返回 false', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue(null)

      const ok = await service.acquireLock('lock:order:1', 30, 'token-abc')

      expect(ok).toBe(false)
    })

    it('未提供 identifier 时自动生成 token', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue('OK')

      const ok = await service.acquireLock('lock:order:1', 30)

      expect(ok).toBe(true)
      const callArgs = client.set.mock.calls[0]
      expect(callArgs[0]).toBe('lock:order:1')
      expect(callArgs[2]).toBe('EX')
      expect(callArgs[3]).toBe(30)
      expect(callArgs[4]).toBe('NX')
      // 自动生成的 token 形如 lock:<timestamp>:<random>
      expect(callArgs[1]).toMatch(/^lock:\d+:[A-Za-z0-9]+$/)
    })
  })

  describe('releaseLock', () => {
    it('提供 identifier 时用 Lua 脚本原子释放（不直接 del）', async () => {
      await createService('redis://localhost:6379')
      client.eval.mockResolvedValue(1)

      await service.releaseLock('lock:order:1', 'token-abc')

      expect(client.eval).toHaveBeenCalledTimes(1)
      expect(client.del).not.toHaveBeenCalled()
      const [script, numkeys, key, identifier] = client.eval.mock.calls[0]
      // 脚本必须先比较 KEYS[1] 的值与 ARGV[1]，匹配才 del，否则返回 0
      expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]")
      expect(script).toContain("redis.call('del', KEYS[1])")
      expect(script).toContain('return 0')
      expect(numkeys).toBe(1)
      expect(key).toBe('lock:order:1')
      expect(identifier).toBe('token-abc')
    })

    it('identifier 不匹配时 Lua 脚本返回 0（不删除，且不抛错）', async () => {
      await createService('redis://localhost:6379')
      // 模拟服务端 Lua 脚本判定 identifier 不匹配，返回 0
      client.eval.mockResolvedValue(0)

      await expect(service.releaseLock('lock:order:1', 'wrong-token')).resolves.toBeUndefined()

      // 删除由 Lua 脚本在服务端判定，不会直接调用 del
      expect(client.del).not.toHaveBeenCalled()
      expect(client.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:order:1',
        'wrong-token',
      )
    })

    it('不提供 identifier 时直接 del', async () => {
      await createService('redis://localhost:6379')
      await service.releaseLock('lock:order:1')

      expect(client.del).toHaveBeenCalledWith('lock:order:1')
      expect(client.eval).not.toHaveBeenCalled()
    })

    it('无 client 时静默不抛错', async () => {
      await createService(undefined)
      await expect(service.releaseLock('lock:order:1', 'token')).resolves.toBeUndefined()
      await expect(service.releaseLock('lock:order:1')).resolves.toBeUndefined()
    })
  })

  describe('withLock', () => {
    it('正常执行函数并释放锁', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue('OK')
      const fn = jest.fn(async () => 'done')

      const ret = await service.withLock('lock:job', 30, fn, 'token-abc')

      expect(ret).toBe('done')
      expect(fn).toHaveBeenCalledTimes(1)
      // 获取锁使用传入 token
      expect(client.set).toHaveBeenCalledWith('lock:job', 'token-abc', 'EX', 30, 'NX')
      // 释放锁使用同一 token 调用 Lua 脚本
      expect(client.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:job',
        'token-abc',
      )
    })

    it('函数抛错时也释放锁（finally）', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue('OK')
      const fn = jest.fn(async () => {
        throw new Error('boom')
      })

      await expect(service.withLock('lock:job', 30, fn, 'token-abc')).rejects.toThrow('boom')

      expect(fn).toHaveBeenCalledTimes(1)
      // 即使函数抛错，仍然释放锁
      expect(client.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:job',
        'token-abc',
      )
    })

    it('获取锁失败时抛错且不执行函数、不释放锁', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue(null) // 锁被占用
      const fn = jest.fn(async () => 'done')

      await expect(service.withLock('lock:job', 30, fn, 'token-abc')).rejects.toThrow(
        '获取锁失败: lock:job',
      )

      expect(fn).not.toHaveBeenCalled()
      // 没获取到锁，不应释放
      expect(client.eval).not.toHaveBeenCalled()
    })

    it('未提供 identifier 时 acquire 与 release 使用同一自动生成 token', async () => {
      await createService('redis://localhost:6379')
      client.set.mockResolvedValue('OK')
      const fn = jest.fn(async () => 42)

      await service.withLock('lock:job', 10, fn)

      const acquireToken = client.set.mock.calls[0][1]
      const releaseIdentifier = client.eval.mock.calls[0][3]
      expect(acquireToken).toBe(releaseIdentifier)
    })
  })

  describe('incr', () => {
    it('提供 TTL 时用 Lua 脚本（incr + expire 原子，首次设置 TTL）', async () => {
      await createService('redis://localhost:6379')
      client.eval.mockResolvedValue(1)

      const val = await service.incr('rate:u1', 60)

      expect(val).toBe(1)
      expect(client.eval).toHaveBeenCalledTimes(1)
      expect(client.incr).not.toHaveBeenCalled()
      const [script, numkeys, key, ttlArg] = client.eval.mock.calls[0]
      // 脚本：首次 incr(value==1) 才 expire
      expect(script).toContain("redis.call('incr', KEYS[1])")
      expect(script).toContain('if value == 1 then')
      expect(script).toContain("redis.call('expire', KEYS[1], ARGV[1])")
      expect(numkeys).toBe(1)
      expect(key).toBe('rate:u1')
      expect(ttlArg).toBe('60')
    })

    it('不提供 TTL 时调用普通 incr（不重设 TTL）', async () => {
      await createService('redis://localhost:6379')
      client.incr.mockResolvedValue(5)

      const val = await service.incr('counter:u1')

      expect(val).toBe(5)
      expect(client.incr).toHaveBeenCalledWith('counter:u1')
      expect(client.eval).not.toHaveBeenCalled()
    })

    it('无 client 时返回 0', async () => {
      await createService(undefined)
      expect(await service.incr('counter:u1', 60)).toBe(0)
      expect(await service.incr('counter:u1')).toBe(0)
    })
  })

  describe('slidingWindowCheck', () => {
    it('返回 1 时表示放行并已记录', async () => {
      await createService('redis://localhost:6379')
      client.eval.mockResolvedValue(1)

      const allowed = await service.slidingWindowCheck('rate:u1', 60000, 10, 'm1')

      expect(allowed).toBe(true)
      expect(client.eval).toHaveBeenCalledTimes(1)
      const [script, numkeys, key, nowArg, windowArg, limitArg, memberArg] =
        client.eval.mock.calls[0]
      // 脚本必须按顺序清理 → 计数 → 判断 → 写入 → 设 TTL
      expect(script).toContain("ZREMRANGEBYSCORE")
      expect(script).toContain("ZCARD")
      expect(script).toContain("ZADD")
      expect(script).toContain("PEXPIRE")
      expect(script).toContain("if count >= limit then")
      expect(numkeys).toBe(1)
      expect(key).toBe('rate:u1')
      expect(windowArg).toBe('60000')
      expect(limitArg).toBe('10')
      expect(memberArg).toBe('m1')
      // now 应为合法毫秒时间戳
      expect(Number(nowArg)).toBeGreaterThan(0)
    })

    it('返回 0 时表示已达上限拒绝', async () => {
      await createService('redis://localhost:6379')
      client.eval.mockResolvedValue(0)

      const allowed = await service.slidingWindowCheck('rate:u1', 60000, 10, 'm2')

      expect(allowed).toBe(false)
    })

    it('无 client 时抛错（风控场景 fail-closed）', async () => {
      await createService(undefined)
      await expect(
        service.slidingWindowCheck('rate:u1', 60000, 10, 'm1'),
      ).rejects.toThrow(/Redis 未配置/)
    })
  })

  describe('slidingWindowCount', () => {
    it('返回当前窗口内成员数', async () => {
      await createService('redis://localhost:6379')
      client.eval.mockResolvedValue(5)

      const count = await service.slidingWindowCount('rate:u1', 60000)

      expect(count).toBe(5)
      const [script, numkeys, key, nowArg, windowArg] = client.eval.mock.calls[0]
      // 脚本只清理 + 计数，不写入
      expect(script).toContain("ZREMRANGEBYSCORE")
      expect(script).toContain("ZCARD")
      expect(script).not.toContain("ZADD")
      expect(numkeys).toBe(1)
      expect(key).toBe('rate:u1')
      expect(windowArg).toBe('60000')
      expect(Number(nowArg)).toBeGreaterThan(0)
    })

    it('无 client 时抛错', async () => {
      await createService(undefined)
      await expect(service.slidingWindowCount('rate:u1', 60000)).rejects.toThrow(
        /Redis 未配置/,
      )
    })
  })

  describe('slidingWindowRecord', () => {
    it('用 multi pipeline 执行 zremrangebyscore + zadd + pexpire', async () => {
      await createService('redis://localhost:6379')
      // multi() 返回链式对象，每个命令返回自身，最后 exec() 返回结果
      const chain = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        pexpire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[1, null], [1, null], [1, null]]),
      }
      client.multi.mockReturnValue(chain)

      await service.slidingWindowRecord('rate:u1', 60000, 'm-abc')

      expect(client.multi).toHaveBeenCalledTimes(1)
      // 验证链式调用顺序
      expect(chain.zremrangebyscore).toHaveBeenCalledWith(
        'rate:u1',
        0,
        expect.any(Number),
      )
      // zadd 参数：key, score, member
      expect(chain.zadd).toHaveBeenCalledWith('rate:u1', expect.any(Number), 'm-abc')
      expect(chain.pexpire).toHaveBeenCalledWith('rate:u1', 60000)
      expect(chain.exec).toHaveBeenCalledTimes(1)
    })

    it('无 client 时抛错', async () => {
      await createService(undefined)
      await expect(
        service.slidingWindowRecord('rate:u1', 60000, 'm1'),
      ).rejects.toThrow(/Redis 未配置/)
    })
  })

  describe('onModuleInit / onModuleDestroy', () => {
    it('onModuleInit 配置 URL 时创建 Redis 实例并注册 error/connect/reconnecting 事件', async () => {
      await createService('redis://localhost:6379')

      expect(MockedRedis).toHaveBeenCalledWith(
        'redis://localhost:6379',
        expect.objectContaining({
          maxRetriesPerRequest: 3,
        }),
      )
      expect(client.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(client.on).toHaveBeenCalledWith('connect', expect.any(Function))
      expect(client.on).toHaveBeenCalledWith('reconnecting', expect.any(Function))
    })

    it('onModuleInit 无 URL 时不创建 Redis 实例', async () => {
      await createService(undefined)
      expect(MockedRedis).not.toHaveBeenCalled()
    })

    it('onModuleDestroy 调用 disconnect', async () => {
      await createService('redis://localhost:6379')
      service.onModuleDestroy()
      expect(client.disconnect).toHaveBeenCalledTimes(1)
    })

    it('onModuleDestroy 无 client 时不抛错', async () => {
      await createService(undefined)
      expect(() => service.onModuleDestroy()).not.toThrow()
    })
  })
})
