import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { PaymentOrderStatus } from '../common/enums'
import { Prisma } from '@prisma/client'
import { CashierService } from './cashier.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { JournalService } from '../finance/journal.service'
import { RedisService } from '../redis/redis.service'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword' | 'checkAndIncrementDailyLimit', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction' | 'recordTransactionFrequency', jest.Mock>
type JournalServiceMock = { createEntries: jest.Mock }
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  merchant: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  systemConfig: Record<string, jest.Mock>
  dailyLimitUsage: Record<string, jest.Mock>
} & Record<string, unknown>

type FindUniqueArgs = { where: { id?: string; userId?: string } }
type CreateArgs = { data: Record<string, unknown> }
type UpdateArgs = { where: { id?: string }; data: Record<string, unknown> }

describe('CashierService', () => {
  let service: CashierService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let riskEngine: RiskEngineMock
  let journalService: JournalServiceMock
  let redis: RedisMock

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      merchant: { findUnique: jest.fn() },
      paymentOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
      },
      transactionOrder: { create: jest.fn(), aggregate: jest.fn() },
      account: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      systemConfig: { findUnique: jest.fn() },
      dailyLimitUsage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'dlu1',
          usedAmount: 0,
          version: 0,
        }),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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

    journalService = {
      createEntries: jest.fn().mockResolvedValue(undefined),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        CashierService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: JournalService, useValue: journalService },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(CashierService)
  })

  const verifiedPayer = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  const merchant = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    userId: 'u2',
    merchantNo: 'M1',
    merchantName: '测试商户',
    status: 'APPROVED',
    payRate: 60, // 0.6%
    dailyLimit: 10000000, // 10 万元
    ...overrides,
  })

  describe('createOrder 创建支付订单', () => {
    it('商户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.createOrder('u2', {
          merchantOrderNo: 'MO1',
          amount: 10,
          subject: '商品',
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('商户未审核通过抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(
        merchant({ status: 'PENDING' }),
      )
      await expect(
        service.createOrder('u2', {
          merchantOrderNo: 'MO1',
          amount: 10,
          subject: '商品',
        }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('金额小于等于 0 抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      await expect(
        service.createOrder('u2', {
          merchantOrderNo: 'MO1',
          amount: 0,
          subject: '商品',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('商户订单号已存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue({ id: 'po1' })
      await expect(
        service.createOrder('u2', {
          merchantOrderNo: 'MO1',
          amount: 10,
          subject: '商品',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('并发创建同商户订单号触发 P2002 时查回原单幂等返回', async () => {
      // M2：并发场景下两个请求同时通过预检查，第二个 create 触发唯一约束冲突，
      // 查回原单幂等返回，避免商户并发重试拿不到已创建订单
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      const existed = {
        id: 'po-existing',
        merchantId: 'm1',
        merchantOrderNo: 'MO1',
        orderNo: 'P-EXIST',
        amount: 1000,
        fee: 0,
        status: 'PENDING',
      }
      prisma.paymentOrder.findFirst
        .mockResolvedValueOnce(null) // 预检查通过
        .mockResolvedValueOnce(existed) // P2002 catch 内查回原单
      prisma.paymentOrder.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      )

      const order = await service.createOrder('u2', {
        merchantOrderNo: 'MO1',
        amount: 10,
        subject: '商品',
      })
      expect(order.id).toBe('po-existing')
      expect(order.merchantOrderNo).toBe('MO1')
    })

    it('成功创建支付订单(PENDING)', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue(null)
      prisma.paymentOrder.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'po1', status: 'PENDING', ...query.data })
      })

      const order = await service.createOrder('u2', {
        merchantOrderNo: 'MO1',
        amount: 10,
        subject: '商品',
      })
      expect(order.status).toBe('PENDING')
      expect(order.amount).toBe(1000) // 10 元 = 1000 分
      expect(order.merchantId).toBe('m1')
      expect(order.merchantOrderNo).toBe('MO1')
      // 默认 30 分钟过期
      expect(order.expiredAt).toBeInstanceOf(Date)
    })
  })

  describe('pay 支付订单', () => {
    const baseOrder = (overrides: Record<string, unknown> = {}) => ({
      id: 'po1',
      orderNo: 'P1',
      merchantId: 'm1',
      merchantOrderNo: 'MO1',
      amount: 1000, // 10 元
      fee: 0,
      status: 'PENDING',
      payerId: null,
      paidAt: null,
      expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      callbackUrl: null,
      merchant: merchant(),
      ...overrides,
    })

    const setupHappyPath = (orderOverrides: Record<string, unknown> = {}) => {
      prisma.paymentOrder.findUnique.mockResolvedValue(baseOrder(orderOverrides))
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedPayer())
        if (id === 'u2')
          return Promise.resolve({ id: 'u2', nickname: '商户老板' })
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        // H1: 事务内按 id 重新读取扣款后真实余额（availableBalance 已扣减）
        if (query.where.id === 'a1')
          return Promise.resolve({
            id: 'a1',
            userId: 'u1',
            availableBalance: 9000,
            totalBalance: 9000,
            status: 'ACTIVE',
          })
        if (query.where.id === 'a2')
          return Promise.resolve({
            id: 'a2',
            userId: 'u2',
            availableBalance: 994,
            totalBalance: 994,
            status: 'ACTIVE',
          })
        // 按 userId 查询：事务内初始读取，返回扣款前余额
        if (query.where.userId === 'u1')
          return Promise.resolve({
            id: 'a1',
            userId: 'u1',
            availableBalance: 10000,
            totalBalance: 10000,
            status: 'ACTIVE',
          })
        if (query.where.userId === 'u2')
          return Promise.resolve({
            id: 'a2',
            userId: 'u2',
            availableBalance: 0,
            totalBalance: 0,
            status: 'ACTIVE',
          })
        return Promise.resolve(null)
      })
      prisma.account.update.mockImplementation((args: unknown) => {
        const query = args as UpdateArgs
        if (query.where.id === 'a1')
          return Promise.resolve({ availableBalance: 9000, totalBalance: 9000 })
        return Promise.resolve({ availableBalance: 994, totalBalance: 994 })
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 })
      // 商户日限额：默认未使用
      prisma.dailyLimitUsage.findFirst.mockResolvedValue({
        id: 'dlu1',
        usedAmount: 0,
        version: 0,
      })
      prisma.dailyLimitUsage.updateMany.mockResolvedValue({ count: 1 })
      // 付款方日限额：默认 5 万，未使用
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      prisma.transactionOrder.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 't1', orderNo: 'PAY1', ...query.data })
      })
      // update 返回不带 callbackUrl，避免触发异步通知
      prisma.paymentOrder.update.mockResolvedValue({
        id: 'po1',
        orderNo: 'P1',
        status: 'PAID',
        paidAt: new Date(),
        payerId: 'u1',
        fee: 6,
      })
    }

    it('订单不存在抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(
        service.pay('u1', { orderNo: 'NOPE', payPassword: '123456' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('本人重复支付(已 PAID)幂等返回，不进入事务', async () => {
      // M1：订单已 PAID 且 payerId 与请求方一致时幂等返回，
      // 避免网络超时重试时第二次请求命中状态机抛错、用户不知已支付成功
      prisma.paymentOrder.findUnique.mockResolvedValue(
        baseOrder({ status: 'PAID', payerId: 'u1' }),
      )
      const result = await service.pay('u1', {
        orderNo: 'P1',
        payPassword: '123456',
        idempotencyKey: 'idem-1',
      })
      expect(result.status).toBe('PAID')
      expect(result.payerId).toBe('u1')
      // 幂等返回不应进入事务、不应再次校验支付密码
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(usersService.verifyPayPassword).not.toHaveBeenCalled()
      expect(prisma.paymentOrder.updateMany).not.toHaveBeenCalled()
    })

    it('订单已被他人支付时重复支付抛错(非本人不可幂等)', async () => {
      // 安全：仅付款方本人可幂等返回，他人重复请求仍走状态机拦截
      prisma.paymentOrder.findUnique.mockResolvedValue(
        baseOrder({ status: 'PAID', payerId: 'u3' }),
      )
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 0 })
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedPayer())
        if (id === 'u2')
          return Promise.resolve({ id: 'u2', nickname: '商户老板' })
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 10000,
        totalBalance: 10000,
        status: 'ACTIVE',
      })
      prisma.dailyLimitUsage.findFirst.mockResolvedValue({
        id: 'dlu1',
        usedAmount: 0,
        version: 0,
      })
      prisma.dailyLimitUsage.updateMany.mockResolvedValue({ count: 1 })
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      await expect(
        service.pay('u1', { orderNo: 'P1', payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('订单已关闭 pay 抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        baseOrder({ status: 'CLOSED' }),
      )
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 0 })
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedPayer())
        if (id === 'u2')
          return Promise.resolve({ id: 'u2', nickname: '商户老板' })
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 10000,
        totalBalance: 10000,
        status: 'ACTIVE',
      })
      prisma.dailyLimitUsage.findFirst.mockResolvedValue({
        id: 'dlu1',
        usedAmount: 0,
        version: 0,
      })
      prisma.dailyLimitUsage.updateMany.mockResolvedValue({ count: 1 })
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      await expect(
        service.pay('u1', { orderNo: 'P1', payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('余额不足抛错', async () => {
      setupHappyPath()
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.pay('u1', { orderNo: 'P1', payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('商户日限额超限抛错', async () => {
      // 商户日限额 1000 分（10 元），本次 10 元，已用 100 → 超限
      setupHappyPath({
        merchant: merchant({ dailyLimit: 1000 }),
      })
      prisma.dailyLimitUsage.findFirst.mockResolvedValue({
        id: 'dlu1',
        usedAmount: 100,
        version: 0,
      })
      prisma.dailyLimitUsage.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.pay('u1', { orderNo: 'P1', payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('支付成功：扣款+商户入账(扣手续费)+流水+账单+订单 PAID', async () => {
      setupHappyPath()
      const result = await service.pay('u1', {
        orderNo: 'P1',
        payPassword: '123456',
      })
      expect(result.status).toBe('PAID')

      // 手续费：1000 * 60 / 10000 = 6 分；实收 994
      // 付款方原子扣款 1000
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
      // 商户入账 994（扣手续费）
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a2' },
          data: {
            availableBalance: { increment: 994 },
            totalBalance: { increment: 994 },
          },
        }),
      )
      // 双方流水
      expect(prisma.accountLedger.create).toHaveBeenCalledTimes(2)
      // 流水 balanceBefore 来自事务内 findUnique
      expect(prisma.accountLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceBefore: 10000,
            balanceAfter: 9000,
          }),
        }),
      )
      // 双方账单
      expect(prisma.bill.create).toHaveBeenCalledTimes(2)
      // 订单原子更新为 PAID
      expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'po1',
            status: 'PENDING',
          }),
          data: expect.objectContaining({
            status: 'PAID',
            payerId: 'u1',
            fee: 6,
          }),
        }),
      )
      // 交易订单 type=PAYMENT status=SUCCESS，记录手续费
      expect(prisma.transactionOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PAYMENT',
            status: 'SUCCESS',
            amount: 1000,
            fee: 6,
            fromUserId: 'u1',
            toUserId: 'u2',
            relatedOrderNo: 'P1',
          }),
        }),
      )
    })

    it('付款方账户被冻结抛错', async () => {
      setupHappyPath()
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.userId === 'u1')
          return Promise.resolve({
            id: 'a1',
            userId: 'u1',
            availableBalance: 10000,
            totalBalance: 10000,
            status: 'FROZEN',
          })
        return Promise.resolve({
          id: 'a2',
          userId: 'u2',
          availableBalance: 0,
          totalBalance: 0,
          status: 'ACTIVE',
        })
      })
      await expect(
        service.pay('u1', { orderNo: 'P1', payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('收款方账户被冻结抛错', async () => {
      setupHappyPath()
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.userId === 'u1')
          return Promise.resolve({
            id: 'a1',
            userId: 'u1',
            availableBalance: 10000,
            totalBalance: 10000,
            status: 'ACTIVE',
          })
        return Promise.resolve({
          id: 'a2',
          userId: 'u2',
          availableBalance: 0,
          totalBalance: 0,
          status: 'FROZEN',
        })
      })
      await expect(
        service.pay('u1', { orderNo: 'P1', payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('closeExpiredOrders 关闭过期订单', () => {
    it('批量关闭过期订单', async () => {
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 3 })
      await service.closeExpiredOrders()
      expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
            expiredAt: { lt: expect.any(Date) },
          }),
          data: { status: 'CLOSED' },
        }),
      )
    })
  })

  describe('listMyOrders 商户订单列表', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.listMyOrders('u1', {})).rejects.toThrow(NotFoundException)
    })

    it('支持按状态筛选', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findMany.mockResolvedValue([])
      prisma.paymentOrder.count.mockResolvedValue(0)

      await service.listMyOrders('u2', { status: PaymentOrderStatus.PAID, page: 1, limit: 10 })
      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { merchantId: 'm1', status: 'PAID' },
        }),
      )
    })

    it('支持按日期范围筛选', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findMany.mockResolvedValue([])
      prisma.paymentOrder.count.mockResolvedValue(0)

      await service.listMyOrders('u2', { startDate: '2025-01-01', endDate: '2025-01-31' })
      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            merchantId: 'm1',
            createdAt: {
              gte: new Date('2025-01-01T00:00:00'),
              lte: new Date('2025-01-31T23:59:59'),
            },
          },
        }),
      )
    })
  })
})
