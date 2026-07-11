import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { WithdrawalsService } from './withdrawals.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { RiskEngineService } from '../risk/risk-engine.service'
import { MockChannel } from '../payment-channels/channels/mock.channel'
import { JournalService } from '../finance/journal.service'
import { CryptoService } from '../crypto/crypto.service'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type ChannelRegistryMock = Record<'getChannel' | 'getEnabledConfig' | 'getChannelByType', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction', jest.Mock>
type JournalServiceMock = { createEntries: jest.Mock }
type CryptoServiceMock = { encrypt: jest.Mock; decrypt: jest.Mock; mask: jest.Mock }
type PrismaMock = {
  $transaction: jest.Mock
  systemConfig: Record<string, jest.Mock>
  merchant: Record<string, jest.Mock>
  user: Record<string, jest.Mock>
  withdrawalOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  riskEvent: Record<string, jest.Mock>
} & Record<string, unknown>

describe('WithdrawalsService 并发安全', () => {
  let service: WithdrawalsService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let riskEngine: RiskEngineMock
  let journalService: JournalServiceMock
  let cryptoService: CryptoServiceMock
  let mockChannel: MockChannel

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      systemConfig: { findUnique: jest.fn() },
      merchant: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      withdrawalOrder: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn().mockResolvedValue(true),
    }

    // 串行化 withLock：同一 lockKey 的调用排队执行，模拟 Redis 分布式锁
    const lockQueues = new Map<string, Array<() => void>>()
    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      withLock: jest.fn(async (lockKey: string, _ttl: number, fn: () => Promise<unknown>) => {
        if (lockQueues.has(lockKey)) {
          await new Promise<void>((resolve) => {
            lockQueues.get(lockKey)!.push(resolve)
          })
        } else {
          lockQueues.set(lockKey, [])
        }
        try {
          return await fn()
        } finally {
          const queue = lockQueues.get(lockKey)
          if (queue && queue.length > 0) {
            queue.shift()!()
          } else {
            lockQueues.delete(lockKey)
          }
        }
      }),
    }

    mockChannel = new MockChannel()
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getEnabledConfig: jest.fn().mockResolvedValue({ code: 'mock', name: '模拟渠道', config: {} }),
      getChannelByType: jest.fn().mockResolvedValue({
        channel: mockChannel,
        config: {},
        code: 'mock',
      }),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    journalService = {
      createEntries: jest.fn().mockResolvedValue(undefined),
    }

    cryptoService = {
      encrypt: jest.fn((plain: string) => `ENC(${plain})`),
      decrypt: jest.fn((enc: string) => enc.replace(/^ENC\((.+)\)$/, '$1')),
      mask: jest.fn((v: string) => `MASK(${v})`),
    }

    // 默认非商户，走全局提现费率配置
    prisma.merchant.findUnique.mockResolvedValue(null)

    const module = await Test.createTestingModule({
      providers: [
        WithdrawalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: JournalService, useValue: journalService },
        { provide: CryptoService, useValue: cryptoService },
      ],
    }).compile()

    service = module.get(WithdrawalsService)
  })

  const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  describe('幂等：相同 idempotencyKey 并发提现', () => {
    beforeEach(() => {
      usersService.findById.mockResolvedValue(verifiedUser())
      // 非商户、使用默认费率
      prisma.systemConfig.findUnique.mockResolvedValue(null)
    })

    it('并发两个相同 idempotencyKey 的提现：第一个成功冻结余额，第二个幂等返回已有订单', async () => {
      const createdOrder = {
        id: 'w1',
        orderNo: 'W123',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        status: 'PENDING',
        idempotencyKey: 'key1',
      }
      // 第一个提现：findUnique 返回 null（无已有订单）
      // 第二个提现：findUnique 返回已创建的订单（幂等命中）
      prisma.withdrawalOrder.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdOrder)
      prisma.withdrawalOrder.create.mockResolvedValue(createdOrder)
      prisma.account.findUnique
        .mockResolvedValueOnce({ id: 'a1', userId: 'u1', availableBalance: 10000, frozenBalance: 0 })
        .mockResolvedValue({ id: 'a1', userId: 'u1', availableBalance: 9000, frozenBalance: 1000 })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      // 并发发起两个相同 idempotencyKey 的提现
      const results = await Promise.allSettled([
        service.create('u1', { amount: 10, payPassword: '123456', idempotencyKey: 'key1' }),
        service.create('u1', { amount: 10, payPassword: '123456', idempotencyKey: 'key1' }),
      ])

      // 两个都成功返回（第二个为幂等返回）
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
      const order1 = (results[0] as PromiseFulfilledResult<typeof createdOrder>).value
      const order2 = (results[1] as PromiseFulfilledResult<typeof createdOrder>).value
      // 两次返回同一订单
      expect(order1.id).toBe('w1')
      expect(order2.id).toBe('w1')

      // 余额冻结只发生一次：account.updateMany 仅调用一次
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      // 订单创建只发生一次
      expect(prisma.withdrawalOrder.create).toHaveBeenCalledTimes(1)
      // 两个提现使用同一把锁（基于 userId，create 锁）
      const lockKeys = redis.withLock.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(lockKeys).toEqual(['withdraw:create:u1', 'withdraw:create:u1'])
    })
  })

  describe('可用余额不足：updateMany 返回 count=0', () => {
    beforeEach(() => {
      usersService.findById.mockResolvedValue(verifiedUser())
      prisma.systemConfig.findUnique.mockResolvedValue(null)
    })

    it('可用余额不足时冻结失败，抛 INSUFFICIENT_BALANCE（BadRequestException）', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      // 可用余额 500 分 = 5.00 元 < 提现金额 10.00 元 = 1000 分
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 500,
        frozenBalance: 0,
      })
      // updateMany 因可用余额不足返回 count=0
      prisma.account.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.create('u1', { amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)

      // updateMany 被调用但返回 count=0
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'a1',
          availableBalance: { gte: 1000 },
        },
        data: {
          availableBalance: { decrement: 1000 },
          frozenBalance: { increment: 1000 },
        },
      })
      // 余额不足不应创建提现订单
      expect(prisma.withdrawalOrder.create).not.toHaveBeenCalled()
    })
  })

  describe('approve 并发：Redis 锁串行化', () => {
    it('并发两个 approve：第一个成功发起代付，第二个因状态已变更而失败', async () => {
      // 第一个 approve：findUnique 返回 PENDING 订单
      // 第二个 approve：findUnique 返回 PROCESSING 订单（已被第一个改为 PROCESSING）
      const pendingOrder = {
        id: 'w1',
        orderNo: 'W123',
        status: 'PENDING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        channelAccount: 'ENC(6228)',
      }
      const processingOrder = { ...pendingOrder, status: 'PROCESSING' }
      prisma.withdrawalOrder.findUnique
        .mockResolvedValueOnce(pendingOrder)
        .mockResolvedValueOnce(processingOrder)

      // 用户信息（approve 中查询）
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        nickname: '张三',
        identity: { realName: '张三' },
      })
      // 账户信息（approve 事务内查询）
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 1000,
        totalBalance: 10000,
      })
      // 第一个 approve：订单锁定成功（count=1）
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 1 })
      // 第一个 approve：冻结余额扣减成功（count=1）
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      // 第一个 approve 成功后更新订单（保存渠道订单号）
      prisma.withdrawalOrder.update.mockResolvedValue({
        id: 'w1',
        status: 'PROCESSING',
        channel: 'mock',
        channelOrderNo: 'MOCK_P_W123',
      })

      // 并发发起两个 approve
      const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
        service.approve('w1', 'admin1'),
        service.approve('w1', 'admin2'),
      ])

      // 一成功一失败
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      // 失败方应抛 BadRequestException（订单状态不正确）
      const rejectedReason = rejected[0].reason
      expect(rejectedReason).toBeInstanceOf(BadRequestException)

      // 订单锁定 updateMany 只调用一次（第一个 approve），且使用 status:PENDING 条件
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'PROCESSING' }),
        }),
      )
      // 渠道代付只调用一次（仅第一个 approve 触发）
      expect(channelRegistry.getChannelByType).toHaveBeenCalledTimes(1)
      // 订单更新（保存渠道订单号）只调用一次
      expect(prisma.withdrawalOrder.update).toHaveBeenCalledTimes(1)
      // 两个 approve 使用同一把锁（基于 orderId）
      const lockKeys = redis.withLock.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(lockKeys).toEqual(['withdraw:approve:w1', 'withdraw:approve:w1'])
      // 串行化：withLock 被调用两次（排队执行，不并发）
      expect(redis.withLock).toHaveBeenCalledTimes(2)
    })
  })

  describe('approve 冻结余额不足：account.updateMany 返回 count=0', () => {
    it('冻结余额不足时抛 FROZEN_BALANCE_INSUFFICIENT（BadRequestException）', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        status: 'PENDING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        channelAccount: 'ENC(6228)',
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        nickname: '张三',
        identity: { realName: '张三' },
      })
      // 账户冻结余额 500 < 订单金额 1000
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 500,
        totalBalance: 9500,
      })
      // 订单锁定成功（count=1）
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 1 })
      // 冻结余额扣减失败（count=0）
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      // 监听渠道代付调用（冻结余额不足时不应发起代付）
      const createPayoutSpy = jest.spyOn(mockChannel, 'createPayout')

      await expect(service.approve('w1', 'admin1')).rejects.toThrow(BadRequestException)

      // 订单锁定成功（status:PENDING → PROCESSING）
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'PROCESSING' }),
        }),
      )
      // 冻结余额扣减使用 frozenBalance 条件
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            frozenBalance: { gte: 1000 },
          },
          data: {
            frozenBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      // 冻结余额不足：渠道已在事务前获取，但实际代付 createPayout 不应被调用
      expect(createPayoutSpy).not.toHaveBeenCalled()
    })
  })
})
