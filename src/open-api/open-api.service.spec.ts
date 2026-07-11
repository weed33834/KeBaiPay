import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenApiService } from './open-api.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'

type ConfigServiceMock = Record<'get', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock' | 'get' | 'set' | 'del' | 'acquireLock', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction' | 'recordTransactionFrequency', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  merchant: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  user: Record<string, jest.Mock>
} & Record<string, unknown>

type FindUniqueArgs = { where: { id?: string; userId?: string } }
type CreateArgs = { data: Record<string, unknown> }
type UpdateArgs = { where: { id?: string }; data: Record<string, unknown> }

describe('OpenApiService', () => {
  let service: OpenApiService
  let prisma: PrismaMock
  let configService: ConfigServiceMock
  let redis: RedisMock
  let riskEngine: RiskEngineMock

  const app = {
    id: 'app1',
    merchantId: 'm1',
    appId: 'app_xxx',
    appSecret: 'secret',
    name: '默认应用',
    callbackUrl: null,
    status: 'ACTIVE',
  }

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      merchant: { findUnique: jest.fn() },
      paymentOrder: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      transactionOrder: { findUnique: jest.fn(), create: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      user: { findUnique: jest.fn() },
    }

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      acquireLock: jest.fn().mockResolvedValue(true),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
      recordTransactionFrequency: jest.fn().mockResolvedValue(undefined),
    }

    const module = await Test.createTestingModule({
      providers: [
        OpenApiService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redis },
        { provide: RiskEngineService, useValue: riskEngine },
      ],
    }).compile()

    service = module.get(OpenApiService)
  })

  const merchant = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    userId: 'u2',
    merchantNo: 'M1',
    merchantName: '测试商户',
    status: 'APPROVED',
    ...overrides,
  })

  describe('createOrder 创建订单', () => {
    it('商户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.createOrder(app, {
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
        service.createOrder(app, {
          merchantOrderNo: 'MO1',
          amount: 10,
          subject: '商品',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('金额小于等于 0 抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      await expect(
        service.createOrder(app, {
          merchantOrderNo: 'MO1',
          amount: 0,
          subject: '商品',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功创建订单', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue(null)
      prisma.paymentOrder.create.mockImplementation((args: unknown) => {
        const query = args as { data: Record<string, unknown> }
        return Promise.resolve({ id: 'po1', status: 'PENDING', ...query.data })
      })

      const result = await service.createOrder(app, {
        merchantOrderNo: 'MO1',
        amount: 10,
        subject: '商品',
      })
      expect(result.orderNo).toBeDefined()
      expect(result.amountYuan).toBe('10.00')
      expect(result.status).toBe('PENDING')
      expect(result.cashierUrl).toContain(result.orderNo)
    })

    it('幂等：同 merchantOrderNo 重复请求返回原订单不抛错', async () => {
      const existing = {
        orderNo: 'P1',
        appId: 'app_xxx',
        amount: 1000,
        status: 'PENDING',
        expiredAt: new Date(Date.now() + 60000),
      }
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue(existing)

      const result = await service.createOrder(app, {
        merchantOrderNo: 'MO1',
        amount: 10,
        subject: '商品',
      })
      // 返回原订单，不抛错，不重复创建
      expect(result.orderNo).toBe('P1')
      expect(prisma.paymentOrder.create).not.toHaveBeenCalled()
    })
  })

  describe('getOrder 查询订单', () => {
    it('订单不存在抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.getOrder(app, 'NOPE')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('跨商户查询抛错（app 归属校验）', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'po1',
        orderNo: 'P1',
        amount: 1000,
        fee: 0,
        refundAmount: 0,
        appId: 'app_other',
      })
      await expect(service.getOrder(app, 'P1')).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('同 app 查询返回正确订单', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'po1',
        orderNo: 'P1',
        amount: 1000,
        fee: 6,
        refundAmount: 0,
        appId: app.appId,
      })
      const result = await service.getOrder(app, 'P1')
      expect(result.orderNo).toBe('P1')
      expect(result.amountYuan).toBe('10.00')
      expect(result.feeYuan).toBe('0.06')
      expect(result.refundAmountYuan).toBe('0.00')
    })
  })

  describe('refund 退款', () => {
    const paidOrder = (overrides: Record<string, unknown> = {}) => ({
      id: 'po1',
      orderNo: 'P1',
      merchantId: 'm1',
      merchantOrderNo: 'MO1',
      appId: app.appId,
      amount: 1000,
      fee: 6,
      refundAmount: 0,
      status: 'PAID',
      payerId: 'u1',
      merchant: merchant(),
      ...overrides,
    })

    const setupRefundHappyPath = (orderOverrides: Record<string, unknown> = {}) => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        paidOrder(orderOverrides),
      )
      prisma.user.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.id === 'u2')
          return Promise.resolve({ nickname: '商户老板' })
        if (query.where.id === 'u1')
          return Promise.resolve({ nickname: '张三' })
        return Promise.resolve(null)
      })
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.userId === 'u2' || query.where.id === 'a2')
          return Promise.resolve({
            id: 'a2',
            userId: 'u2',
            availableBalance: 10000,
            totalBalance: 10000,
          })
        if (query.where.userId === 'u1' || query.where.id === 'a1')
          return Promise.resolve({
            id: 'a1',
            userId: 'u1',
            availableBalance: 5000,
            totalBalance: 5000,
          })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockImplementation((args: unknown) => {
        const query = args as UpdateArgs
        if (query.where.id === 'a1')
          return Promise.resolve({ availableBalance: 6000, totalBalance: 6000 })
        return Promise.resolve({ availableBalance: 9000, totalBalance: 9000 })
      })
      prisma.transactionOrder.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 't1', orderNo: 'R1', ...query.data })
      })
      prisma.paymentOrder.update.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ orderNo: 'P1', ...query.data })
      })
      // 乐观锁更新订单：updateMany 返回 count=1 表示成功
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 })
    }

    it('订单不存在抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(
        service.refund(app, { orderNo: 'NOPE' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('跨商户退款抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        paidOrder({ appId: 'app_other' }),
      )
      await expect(
        service.refund(app, { orderNo: 'P1' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('订单状态不可退款抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        paidOrder({ status: 'PENDING' }),
      )
      await expect(
        service.refund(app, { orderNo: 'P1' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('退款超额抛错（退款额>可退额）', async () => {
      setupRefundHappyPath()
      await expect(
        service.refund(app, { orderNo: 'P1', amount: 20 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('退款成功：商户扣减+付款方加回+订单 refundAmount 累加+全额退置 REFUNDED', async () => {
      setupRefundHappyPath()
      const result = await service.refund(app, {
        orderNo: 'P1',
        reason: '商品缺货',
      }) as {
        refundAmountYuan: string
        totalRefundAmountYuan: string
        refundableYuan: string
      }
      // 全额退：1000 分
      expect(result.refundAmountYuan).toBe('10.00')
      expect(result.totalRefundAmountYuan).toBe('10.00')
      expect(result.refundableYuan).toBe('0.00')

      // 商户原子扣减 1000
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a2',
            availableBalance: { gte: 1000 },
          },
          data: {
            availableBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      // 付款方加回 1000
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 退款交易订单
      expect(prisma.transactionOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'REFUND',
            status: 'SUCCESS',
            amount: 1000,
            fromUserId: 'u2',
            toUserId: 'u1',
            relatedOrderNo: 'P1',
          }),
        }),
      )
      // 订单 refundAmount 累加 + 全额退置 REFUNDED（使用 updateMany 乐观锁）
      expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po1', status: 'PAID', refundAmount: 0 },
          data: expect.objectContaining({
            refundAmount: 1000,
            status: 'REFUNDED',
            refundedBy: app.appId,
            refundReason: '商品缺货',
          }),
        }),
      )
      // 双方流水 + 双方账单
      expect(prisma.accountLedger.create).toHaveBeenCalledTimes(2)
      expect(prisma.bill.create).toHaveBeenCalledTimes(2)
    })

    it('商户余额不足时 updateMany 返回 count 0 抛错并回滚', async () => {
      setupRefundHappyPath()
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.refund(app, { orderNo: 'P1' }),
      ).rejects.toThrow(BadRequestException)
      // 付款方账户不应被加回，交易订单等不应创建
      expect(prisma.account.update).not.toHaveBeenCalled()
      expect(prisma.transactionOrder.create).not.toHaveBeenCalled()
      expect(prisma.accountLedger.create).not.toHaveBeenCalled()
      expect(prisma.bill.create).not.toHaveBeenCalled()
    })

    it('付款方账户不存在时抛错并回滚', async () => {
      setupRefundHappyPath()
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.userId === 'u2')
          return Promise.resolve({
            id: 'a2',
            userId: 'u2',
            availableBalance: 10000,
            totalBalance: 10000,
          })
        // payer 账户不存在
        return Promise.resolve(null)
      })
      await expect(
        service.refund(app, { orderNo: 'P1' }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.account.update).not.toHaveBeenCalled()
      expect(prisma.transactionOrder.create).not.toHaveBeenCalled()
      expect(prisma.accountLedger.create).not.toHaveBeenCalled()
      expect(prisma.bill.create).not.toHaveBeenCalled()
    })

    it('幂等：相同 idempotencyKey 直接返回已有交易', async () => {
      setupRefundHappyPath()
      const existed = { id: 't0', orderNo: 'R0', amount: 1000 }
      prisma.transactionOrder.findUnique.mockResolvedValue(existed)
      const result = await service.refund(app, {
        orderNo: 'P1',
        idempotencyKey: 'key-1',
      })
      expect(result).toBe(existed)
      // 不重复扣款
      expect(prisma.account.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('transfer 商户转账', () => {
    const setupTransferHappyPath = () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.user.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.id === 'u3')
          return Promise.resolve({
            id: 'u3',
            nickname: '王五',
            realNameStatus: 'VERIFIED',
            status: 'ACTIVE',
          })
        if (query.where.id === 'u2')
          return Promise.resolve({
            id: 'u2',
            nickname: '商户老板',
            realNameStatus: 'VERIFIED',
            status: 'ACTIVE',
          })
        return Promise.resolve(null)
      })
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.userId === 'u2' || query.where.id === 'a2')
          return Promise.resolve({
            id: 'a2',
            userId: 'u2',
            availableBalance: 10000,
            totalBalance: 10000,
            status: 'ACTIVE',
          })
        if (query.where.userId === 'u3' || query.where.id === 'a3')
          return Promise.resolve({
            id: 'a3',
            userId: 'u3',
            availableBalance: 0,
            totalBalance: 0,
            status: 'ACTIVE',
          })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockImplementation((args: unknown) => {
        const query = args as UpdateArgs
        if (query.where.id === 'a3')
          return Promise.resolve({ availableBalance: 1000, totalBalance: 1000 })
        return Promise.resolve({ availableBalance: 9000, totalBalance: 9000 })
      })
      prisma.transactionOrder.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 't1', orderNo: 'T1', ...query.data })
      })
    }

    it('金额小于等于 0 抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      await expect(
        service.transfer(app, { toUserId: 'u3', amount: 0 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('不能转账给自己抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      await expect(
        service.transfer(app, { toUserId: 'u2', amount: 10 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('收款用户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.user.findUnique.mockResolvedValue(null)
      await expect(
        service.transfer(app, { toUserId: 'uX', amount: 10 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('转账成功：商户扣减+对方加回', async () => {
      setupTransferHappyPath()
      const order = await service.transfer(app, {
        toUserId: 'u3',
        amount: 10,
        remark: '佣金',
      })
      expect(order.status).toBe('SUCCESS')
      expect(order.amount).toBe(1000)
      expect(order.type).toBe('TRANSFER')
      expect(order.fromUserId).toBe('u2')
      expect(order.toUserId).toBe('u3')

      // 商户原子扣减
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a2',
            availableBalance: { gte: 1000 },
          },
          data: {
            availableBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      // 对方加回
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a3' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 双方流水 + 双方账单
      expect(prisma.accountLedger.create).toHaveBeenCalledTimes(2)
      expect(prisma.bill.create).toHaveBeenCalledTimes(2)
    })

    it('商户余额不足时 updateMany 返回 count 0 抛错并回滚', async () => {
      setupTransferHappyPath()
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.transfer(app, { toUserId: 'u3', amount: 10 }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.account.update).not.toHaveBeenCalled()
      expect(prisma.transactionOrder.create).not.toHaveBeenCalled()
      expect(prisma.accountLedger.create).not.toHaveBeenCalled()
      expect(prisma.bill.create).not.toHaveBeenCalled()
    })

    it('幂等：相同 idempotencyKey 直接返回已有交易', async () => {
      setupTransferHappyPath()
      const existed = { id: 't0', orderNo: 'T0', amount: 1000 }
      prisma.transactionOrder.findUnique.mockResolvedValue(existed)
      const result = await service.transfer(app, {
        toUserId: 'u3',
        amount: 10,
        idempotencyKey: 'key-2',
      })
      expect(result).toBe(existed)
      expect(prisma.account.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('balance 余额查询', () => {
    it('商户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.balance(app)).rejects.toThrow(NotFoundException)
    })

    it('账户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.account.findUnique.mockResolvedValue(null)
      await expect(service.balance(app)).rejects.toThrow(NotFoundException)
    })

    it('返回正确余额', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.account.findUnique.mockResolvedValue({
        id: 'a2',
        userId: 'u2',
        availableBalance: 12345,
        frozenBalance: 100,
        totalBalance: 12445,
      })
      const result = await service.balance(app)
      expect(result.availableYuan).toBe('123.45')
      expect(result.frozenYuan).toBe('1.00')
      expect(result.totalYuan).toBe('124.45')
    })
  })
})
