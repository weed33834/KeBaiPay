import { Test } from '@nestjs/testing'
import { SettlementService } from './settlement.service'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from './notifications.service'

type PrismaMock = {
  paymentOrder: {
    findMany: jest.Mock
    updateMany: jest.Mock
    groupBy: jest.Mock
  }
  user: { findUnique: jest.Mock }
  merchant: { findUnique: jest.Mock; findMany: jest.Mock }
  account: { findUnique: jest.Mock; update: jest.Mock }
  accountLedger: { create: jest.Mock }
  platformAccount: { findUnique: jest.Mock; update: jest.Mock }
  $transaction: jest.Mock
}
type NotificationsMock = { notifySettlementComplete: jest.Mock }

describe('SettlementService', () => {
  let service: SettlementService
  let prisma: PrismaMock
  let notifications: NotificationsMock

  beforeEach(async () => {
    prisma = {
      paymentOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      user: { findUnique: jest.fn() },
      merchant: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      account: { findUnique: jest.fn(), update: jest.fn() },
      accountLedger: { create: jest.fn() },
      platformAccount: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    }
    notifications = { notifySettlementComplete: jest.fn().mockResolvedValue(true) }

    const module = await Test.createTestingModule({
      providers: [
        SettlementService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile()

    service = module.get(SettlementService)
  })

  describe('runDailySettlement', () => {
    it('无待结算订单时返回空数组', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue([])
      const res = await service.runDailySettlement()
      expect(res).toEqual([])
      expect(prisma.paymentOrder.updateMany).not.toHaveBeenCalled()
    })

    it('单商户多订单时计算总额、更新结算标记、记录账本、发送通知', async () => {
      const orders = [
        {
          id: 'o1',
          merchantId: 'm1',
          amount: 10000,
          fee: 100,
          merchant: { id: 'm1', merchantName: '商户A', userId: 'u1' },
        },
        {
          id: 'o2',
          merchantId: 'm1',
          amount: 5000,
          fee: 50,
          merchant: { id: 'm1', merchantName: '商户A', userId: 'u1' },
        },
      ]
      prisma.paymentOrder.findMany.mockResolvedValue(orders)
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.com' })
      prisma.merchant.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1' })
      prisma.account.findUnique.mockResolvedValue({ id: 'a1', availableBalance: 0 })
      prisma.account.update.mockResolvedValue({ id: 'a1', availableBalance: 14850 })

      const res = await service.runDailySettlement()

      expect(res).toHaveLength(1)
      expect(res[0]).toMatchObject({
        merchantId: 'm1',
        merchantName: '商户A',
        orderCount: 2,
        totalAmount: 15000,
        totalFee: 150,
        settleAmount: 14850,
        status: 'SUCCESS',
      })
      // 更新订单 settledAt
      expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['o1', 'o2'] } } }),
      )
      // 记录账本
      expect(prisma.accountLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountId: 'a1', type: 'SETTLEMENT', amount: 14850 }),
        }),
      )
      // 发送结算通知
      expect(notifications.notifySettlementComplete).toHaveBeenCalledWith(
        'a@example.com',
        '商户A',
        '148.50',
        expect.any(String),
      )
    })

    it('商户处理抛错时返回 ERROR 状态，不影响其他商户', async () => {
      const orders = [
        {
          id: 'o1',
          merchantId: 'm1',
          amount: 10000,
          fee: 100,
          merchant: { id: 'm1', merchantName: '商户A', userId: 'u1' },
        },
        {
          id: 'o2',
          merchantId: 'm2',
          amount: 2000,
          fee: 20,
          merchant: { id: 'm2', merchantName: '商户B', userId: 'u2' },
        },
      ]
      prisma.paymentOrder.findMany.mockResolvedValue(orders)
      // 商户 A 的 updateMany 抛错
      prisma.paymentOrder.updateMany
        .mockRejectedValueOnce(new Error('db-down'))
        .mockResolvedValueOnce({ count: 1 })
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'b@example.com' })
      prisma.merchant.findUnique.mockResolvedValue({ id: 'm2', userId: 'u2' })
      prisma.account.findUnique.mockResolvedValue({ id: 'a2', availableBalance: 0 })
      prisma.account.update.mockResolvedValue({ id: 'a2', availableBalance: 1980 })

      const res = await service.runDailySettlement()

      expect(res).toHaveLength(2)
      const errResult = res.find((r) => r.merchantId === 'm1')
      expect(errResult?.status).toBe('ERROR')
      expect(errResult?.reason).toBe('db-down')
      const okResult = res.find((r) => r.merchantId === 'm2')
      expect(okResult?.status).toBe('SUCCESS')
    })
  })

  describe('getUnsettledSummary', () => {
    it('无未结算数据时返回零值结构', async () => {
      prisma.paymentOrder.groupBy.mockResolvedValue([])
      const res = await service.getUnsettledSummary()
      expect(res).toEqual({ totalCount: 0, totalAmount: 0, merchants: [] })
    })

    it('按商户分组返回未结算汇总', async () => {
      prisma.paymentOrder.groupBy.mockResolvedValue([
        {
          merchantId: 'm1',
          _count: { id: 3 },
          _sum: { amount: 10000, fee: 100 },
        },
        {
          merchantId: 'm2',
          _count: { id: 1 },
          _sum: { amount: 2000, fee: 20 },
        },
      ])
      prisma.merchant.findMany.mockResolvedValue([
        { id: 'm1', merchantName: '商户A' },
        { id: 'm2', merchantName: '商户B' },
      ])

      const res = await service.getUnsettledSummary()

      expect(res.totalCount).toBe(4)
      expect(res.totalAmount).toBe(12000)
      expect(res.merchants).toEqual([
        { merchantId: 'm1', merchantName: '商户A', count: 3, amount: 10000, fee: 100, settleAmount: 9900 },
        { merchantId: 'm2', merchantName: '商户B', count: 1, amount: 2000, fee: 20, settleAmount: 1980 },
      ])
    })
  })
})
