import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { QrCodesService } from './qr-codes.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword' | 'checkAndIncrementDailyLimit', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction' | 'recordTransactionFrequency', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  qrCode: Record<string, jest.Mock>
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  systemConfig: Record<string, jest.Mock>
  dailyLimitUsage: Record<string, jest.Mock>
} & Record<string, unknown>

type FindUniqueArgs = { where: { id?: string; userId?: string } }
type CreateArgs = { data: Record<string, unknown> }

describe('QrCodesService', () => {
  let service: QrCodesService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let riskEngine: RiskEngineMock
  let redis: RedisMock

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      qrCode: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
      transactionOrder: { findUnique: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      systemConfig: { findUnique: jest.fn() },
      dailyLimitUsage: { upsert: jest.fn(), updateMany: jest.fn() },
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn(),
      checkAndIncrementDailyLimit: jest.fn(),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
      recordTransactionFrequency: jest.fn().mockResolvedValue(undefined),
    }

    // M5：pay 同 idempotencyKey 并发请求通过 Redis 锁串行化
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        QrCodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(QrCodesService)
  })

  const verifiedPayer = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  const activeAccount = (overrides: Record<string, unknown> = {}) => ({
    status: 'ACTIVE',
    ...overrides,
  })

  describe('getPersonalCode 个人码懒创建', () => {
    it('不存在时创建个人码', async () => {
      prisma.qrCode.findFirst.mockResolvedValue(null)
      prisma.qrCode.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'q1', code: 'KB-1', ...query.data })
      })

      const code = await service.getPersonalCode('u1')
      expect(code.type).toBe('PERSONAL')
      expect(code.status).toBe('ACTIVE')
      expect(code.userId).toBe('u1')
      expect(prisma.qrCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'PERSONAL',
            status: 'ACTIVE',
          }),
        }),
      )
    })

    it('已存在时直接返回不重复创建', async () => {
      const existing = {
        id: 'q1',
        code: 'KB-1',
        userId: 'u1',
        type: 'PERSONAL',
        status: 'ACTIVE',
      }
      prisma.qrCode.findFirst.mockResolvedValue(existing)

      const code = await service.getPersonalCode('u1')
      expect(code).toBe(existing)
      expect(prisma.qrCode.create).not.toHaveBeenCalled()
    })
  })

  describe('createFixedCode 固定金额码', () => {
    it('金额小于等于 0 报错', async () => {
      await expect(
        service.createFixedCode('u1', { amount: 0 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('创建固定金额码（元转分）', async () => {
      prisma.qrCode.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'q1', ...query.data })
      })
      const code = await service.createFixedCode('u1', {
        amount: 5.5,
        remark: '咖啡',
      })
      expect(code.type).toBe('FIXED_AMOUNT')
      expect(code.amount).toBe(550) // 5.5 元 = 550 分
      expect(code.remark).toBe('咖啡')
      expect(code.status).toBe('ACTIVE')
    })
  })

  describe('pay 扫码付款', () => {
    const receiverUser = { id: 'u2', nickname: '李四', status: 'ACTIVE' }
    const qrCode = {
      id: 'qr1',
      code: 'KB-RCV',
      userId: 'u2',
      type: 'PERSONAL',
      amount: null,
      remark: null,
      status: 'ACTIVE',
      user: receiverUser,
    }

    const setupHappyPath = () => {
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedPayer())
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.qrCode.findUnique.mockResolvedValue(qrCode)
      // 不限额
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      prisma.account.findUnique
        .mockResolvedValueOnce(activeAccount({ id: 'a1', userId: 'u1', availableBalance: 10000, totalBalance: 10000 }))
        .mockResolvedValueOnce(activeAccount({ id: 'a2', userId: 'u2', availableBalance: 5000, totalBalance: 5000 }))
        .mockImplementation((args: unknown) => {
          const query = args as FindUniqueArgs
          if (query.where.id === 'a1')
            return Promise.resolve(activeAccount({ id: 'a1', availableBalance: 9000, totalBalance: 9000 }))
          if (query.where.id === 'a2')
            return Promise.resolve(activeAccount({ id: 'a2', availableBalance: 6000, totalBalance: 6000 }))
          return Promise.resolve(null)
        })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.id === 'a1')
          return Promise.resolve(activeAccount({ id: 'a1', availableBalance: 9000, totalBalance: 9000 }))
        return Promise.resolve(activeAccount({ id: 'a2', availableBalance: 6000, totalBalance: 6000 }))
      })
      prisma.transactionOrder.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 't1', orderNo: 'Q1', ...query.data })
      })
    }

    it('付款方 FROZEN 抛错', async () => {
      usersService.findById.mockResolvedValue(
        verifiedPayer({ status: 'FROZEN' }),
      )
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('付款方 EXPENSE_RESTRICTED 抛错', async () => {
      usersService.findById.mockResolvedValue(
        verifiedPayer({ status: 'EXPENSE_RESTRICTED' }),
      )
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('未实名抛错', async () => {
      usersService.findById.mockResolvedValue(
        verifiedPayer({ realNameStatus: 'PENDING' }),
      )
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('余额不足抛错（updateMany 返回 count 0）', async () => {
      setupHappyPath()
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 50, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            availableBalance: { gte: 5000 },
          },
          data: {
            availableBalance: { decrement: 5000 },
            totalBalance: { decrement: 5000 },
          },
        }),
      )
    })

    it('收款码无效抛错', async () => {
      usersService.findById.mockResolvedValue(verifiedPayer())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.qrCode.findUnique.mockResolvedValue(null)
      await expect(
        service.pay('u1', { code: 'NOPE', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('不能向自己的收款码付款', async () => {
      usersService.findById.mockResolvedValue(verifiedPayer())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.qrCode.findUnique.mockResolvedValue({
        ...qrCode,
        userId: 'u1',
        user: { id: 'u1', nickname: '张三', status: 'ACTIVE' },
      })
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('收款方 FROZEN 禁止收款', async () => {
      usersService.findById.mockResolvedValue(verifiedPayer())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.qrCode.findUnique.mockResolvedValue({
        ...qrCode,
        user: { ...receiverUser, status: 'FROZEN' },
      })
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('收款方 INCOME_RESTRICTED 禁止收款', async () => {
      usersService.findById.mockResolvedValue(verifiedPayer())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.qrCode.findUnique.mockResolvedValue({
        ...qrCode,
        user: { ...receiverUser, status: 'INCOME_RESTRICTED' },
      })
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('付款方账户 FROZEN 禁止付款', async () => {
      setupHappyPath()
      prisma.account.findUnique
        .mockReset()
        .mockResolvedValueOnce(activeAccount({ id: 'a1', userId: 'u1', availableBalance: 10000, totalBalance: 10000, status: 'FROZEN' }))
        .mockResolvedValueOnce(activeAccount({ id: 'a2', userId: 'u2', availableBalance: 5000, totalBalance: 5000 }))
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('收款方账户 FROZEN 禁止收款', async () => {
      setupHappyPath()
      prisma.account.findUnique
        .mockReset()
        .mockResolvedValueOnce(activeAccount({ id: 'a1', userId: 'u1', availableBalance: 10000, totalBalance: 10000 }))
        .mockResolvedValueOnce(activeAccount({ id: 'a2', userId: 'u2', availableBalance: 5000, totalBalance: 5000, status: 'FROZEN' }))
      await expect(
        service.pay('u1', { code: 'KB-RCV', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('付款成功：扣款+入账+流水+账单', async () => {
      setupHappyPath()
      const order = await service.pay('u1', {
        code: 'KB-RCV',
        amount: 10,
        payPassword: '123456',
      })
      expect(order.status).toBe('SUCCESS')
      expect(order.amount).toBe(1000) // 10 元
      expect(order.type).toBe('PAYMENT')
      expect(order.fromUserId).toBe('u1')
      expect(order.toUserId).toBe('u2')

      // 付款方原子扣款
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            availableBalance: { gte: 1000 },
          },
          data: {
            availableBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      // 收款方入账
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a2' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 双方流水
      expect(prisma.accountLedger.create).toHaveBeenCalledTimes(2)
      // 双方账单
      expect(prisma.bill.create).toHaveBeenCalledTimes(2)
    })

    it('幂等：同 idempotencyKey 不重复扣款', async () => {
      const existingOrder = {
        id: 't1',
        orderNo: 'Q1',
        type: 'PAYMENT',
        status: 'SUCCESS',
        amount: 1000,
        fromUserId: 'u1',
        toUserId: 'u2',
        idempotencyKey: 'idem-pay',
      }
      prisma.transactionOrder.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingOrder)
      setupHappyPath()

      const first = await service.pay('u1', {
        code: 'KB-RCV',
        amount: 10,
        payPassword: '123456',
        idempotencyKey: 'idem-pay',
      })
      expect(first.id).toBe('t1')
      // 第一次付款方原子扣款一次，收款方入账一次
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.account.update).toHaveBeenCalledTimes(1)

      const second = await service.pay('u1', {
        code: 'KB-RCV',
        amount: 10,
        payPassword: '123456',
        idempotencyKey: 'idem-pay',
      })
      expect(second).toBe(existingOrder)
      // 没有重复扣款
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.account.update).toHaveBeenCalledTimes(1)
    })
  })
})
