import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { TransfersService } from './transfers.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword' | 'checkAndIncrementDailyLimit', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  systemConfig: Record<string, jest.Mock>
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  dailyLimitUsage: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  riskEvent: Record<string, jest.Mock>
} & Record<string, unknown>

describe('TransfersService 并发安全', () => {
  let service: TransfersService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let riskEngine: RiskEngineMock
  let redis: RedisMock

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      transactionOrder: { findUnique: jest.fn(), create: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      dailyLimitUsage: { upsert: jest.fn(), updateMany: jest.fn() },
      accountLedger: { create: jest.fn().mockResolvedValue({}) },
      bill: { create: jest.fn().mockResolvedValue({}) },
      riskEvent: { create: jest.fn().mockResolvedValue({}) },
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn().mockResolvedValue(true),
      checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(undefined),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    // 串行化 withLock：同一 lockKey 的调用排队执行，模拟 Redis 分布式锁
    const lockQueues = new Map<string, Array<() => void>>()
    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      withLock: jest.fn(async (lockKey: string, _ttl: number, fn: () => Promise<unknown>) => {
        if (lockQueues.has(lockKey)) {
          // 已有持锁者，排队等待
          await new Promise<void>((resolve) => {
            lockQueues.get(lockKey)!.push(resolve)
          })
        } else {
          // 首个获取锁，初始化空队列
          lockQueues.set(lockKey, [])
        }
        try {
          return await fn()
        } finally {
          const queue = lockQueues.get(lockKey)
          if (queue && queue.length > 0) {
            // 唤醒下一个等待者
            queue.shift()!()
          } else {
            // 队列空，释放锁
            lockQueues.delete(lockKey)
          }
        }
      }),
    }

    const module = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(TransfersService)
  })

  const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  // 公共：设置通过校验的付款方与收款方用户
  const setupVerifiedUsers = () => {
    usersService.findById.mockImplementation((id: string) => {
      if (id === 'u1') return Promise.resolve(verifiedUser())
      if (id === 'u2') return Promise.resolve(verifiedUser({ id: 'u2', nickname: '李四' }))
      return Promise.resolve(null)
    })
  }

  describe('幂等：相同 idempotencyKey 并发转账', () => {
    beforeEach(() => {
      setupVerifiedUsers()
    })

    it('并发两个相同 idempotencyKey 的转账：第一个成功扣款，第二个幂等返回已有订单', async () => {
      // 第一个转账：findUnique 返回 null（无已有订单）
      // 第二个转账：findUnique 返回已创建的订单（幂等命中）
      const createdOrder = { id: 't1', orderNo: 'T1', fromUserId: 'u1', toUserId: 'u2', amount: 1000 }
      prisma.transactionOrder.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdOrder)
      prisma.transactionOrder.create.mockResolvedValue(createdOrder)
      prisma.account.findUnique.mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId === 'u1' || args.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 10000, totalBalance: 10000, status: 'ACTIVE' })
        if (args.where.userId === 'u2' || args.where.id === 'a2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 })

      // 并发发起两个相同 idempotencyKey 的转账
      const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456', idempotencyKey: 'k1' }),
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456', idempotencyKey: 'k1' }),
      ])

      // 两个都成功返回（第二个为幂等返回）
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
      const order1 = (results[0] as PromiseFulfilledResult<typeof createdOrder>).value
      const order2 = (results[1] as PromiseFulfilledResult<typeof createdOrder>).value
      // 两次返回同一订单
      expect(order1.id).toBe('t1')
      expect(order2.id).toBe('t1')

      // 扣款只发生一次：updateMany 仅调用一次
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      // 订单创建只发生一次
      expect(prisma.transactionOrder.create).toHaveBeenCalledTimes(1)
      // 两个转账使用同一把锁（基于 idempotencyKey）
      const lockKeys = redis.withLock.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(lockKeys).toEqual(['transfer:idem:k1', 'transfer:idem:k1'])
    })
  })

  describe('余额边界：余额恰好等于转账金额', () => {
    beforeEach(() => {
      setupVerifiedUsers()
    })

    it('availableBalance == amount 时 updateMany 成功（count=1）', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      // 余额 1000 分 = 10.00 元，恰好等于转账金额
      prisma.account.findUnique.mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId === 'u1' || args.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 1000, totalBalance: 1000, status: 'ACTIVE' })
        if (args.where.userId === 'u2' || args.where.id === 'a2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 })
      prisma.transactionOrder.create.mockResolvedValue({ id: 't1', orderNo: 'T1', amount: 1000 })

      const order = await service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' })
      expect(order).toBeDefined()
      // updateMany 条件包含 availableBalance: { gte: 1000 }，余额恰好 1000 时通过
      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', availableBalance: { gte: 1000 } },
        data: {
          availableBalance: { decrement: 1000 },
          totalBalance: { decrement: 1000 },
        },
      })
    })
  })

  describe('余额不足：updateMany 返回 count=0', () => {
    beforeEach(() => {
      setupVerifiedUsers()
    })

    it('余额不足时抛 INSUFFICIENT_BALANCE（BadRequestException）', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      // 余额 500 分 = 5.00 元 < 转账金额 10.00 元 = 1000 分
      prisma.account.findUnique.mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId === 'u1' || args.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 500, totalBalance: 500, status: 'ACTIVE' })
        if (args.where.userId === 'u2' || args.where.id === 'a2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      // updateMany 因余额不足返回 count=0
      prisma.account.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)

      // updateMany 被调用但返回 count=0
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', availableBalance: { gte: 1000 } },
        data: {
          availableBalance: { decrement: 1000 },
          totalBalance: { decrement: 1000 },
        },
      })
      // 余额不足不应创建订单
      expect(prisma.transactionOrder.create).not.toHaveBeenCalled()
    })
  })

  describe('同一账户并发转账（无 idempotencyKey）：Redis 锁串行化防双花', () => {
    beforeEach(() => {
      setupVerifiedUsers()
    })

    it('并发两笔转账：第一笔成功扣款，第二笔因余额已被消费而失败（不双花）', async () => {
      // 使用可变状态模拟数据库：余额初始 1000 分 = 10.00 元
      const accountState = { id: 'a1', userId: 'u1', availableBalance: 1000, totalBalance: 1000, status: 'ACTIVE' }
      const updateManyCounts: number[] = []

      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique.mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId === 'u1' || args.where.id === 'a1') return Promise.resolve({ ...accountState })
        if (args.where.userId === 'u2' || args.where.id === 'a2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      // updateMany 模拟数据库原子扣款：余额不足返回 count=0，否则扣款并返回 count=1
      prisma.account.updateMany.mockImplementation((args: { where: { availableBalance?: { gte: number } }, data: { availableBalance?: { decrement: number }, totalBalance?: { decrement: number } } }) => {
        const required = args.where.availableBalance?.gte
        if (required !== undefined && accountState.availableBalance < required) {
          updateManyCounts.push(0)
          return Promise.resolve({ count: 0 })
        }
        // 执行扣款（模拟数据库原子操作）
        if (args.data.availableBalance?.decrement) accountState.availableBalance -= args.data.availableBalance.decrement
        if (args.data.totalBalance?.decrement) accountState.totalBalance -= args.data.totalBalance.decrement
        updateManyCounts.push(1)
        return Promise.resolve({ count: 1 })
      })
      prisma.account.update.mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 })
      prisma.transactionOrder.create.mockResolvedValue({ id: 't1', orderNo: 'T1', amount: 1000 })

      // 并发发起两笔转账（无 idempotencyKey，使用 transfer:user:u1 锁）
      const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' }),
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' }),
      ])

      // 一成功一失败（不双花）
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      // 失败方应因余额不足抛 BadRequestException
      const rejectedReason = rejected[0].reason
      expect(rejectedReason).toBeInstanceOf(BadRequestException)

      // updateMany 被调用两次：第一次 count=1（成功扣款），第二次 count=0（余额不足）
      expect(updateManyCounts).toEqual([1, 0])
      // 订单创建只发生一次（只有成功方才创建）
      expect(prisma.transactionOrder.create).toHaveBeenCalledTimes(1)
      // 两笔转账使用同一把锁（基于 fromUserId）
      const lockKeys = redis.withLock.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(lockKeys).toEqual(['transfer:user:u1', 'transfer:user:u1'])
      // 串行化：withLock 被调用两次（排队执行，不并发）
      expect(redis.withLock).toHaveBeenCalledTimes(2)
    })
  })

  describe('锁键选择', () => {
    beforeEach(() => {
      setupVerifiedUsers()
    })

    it('有 idempotencyKey 时使用 transfer:idem:${key} 锁', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue({ id: 't1', fromUserId: 'u1' })
      await service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456', idempotencyKey: 'my-key' })
      expect(redis.withLock.mock.calls[0][0]).toBe('transfer:idem:my-key')
    })

    it('无 idempotencyKey 时使用 transfer:user:${fromUserId} 锁', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique.mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId === 'u1' || args.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 10000, totalBalance: 10000, status: 'ACTIVE' })
        if (args.where.userId === 'u2' || args.where.id === 'a2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 0, totalBalance: 0 })
      prisma.transactionOrder.create.mockResolvedValue({ id: 't1', orderNo: 'T1' })

      await service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' })
      expect(redis.withLock.mock.calls[0][0]).toBe('transfer:user:u1')
    })
  })
})
