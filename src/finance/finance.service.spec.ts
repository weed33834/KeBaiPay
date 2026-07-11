import { Test } from '@nestjs/testing'
import {
  PaymentOrderStatus,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
} from '../common/enums'
import { FinanceService } from './finance.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettlementService } from '../notifications/settlement.service'

type PrismaMock = {
  transactionOrder: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
  withdrawalOrder: Record<string, jest.Mock>
  merchant: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  dailySnapshot: Record<string, jest.Mock>
}

describe('FinanceService', () => {
  let service: FinanceService
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = {
      transactionOrder: {
        findMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      paymentOrder: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      withdrawalOrder: {
        findMany: jest.fn(),
        aggregate: jest.fn(),
      },
      merchant: {
        findMany: jest.fn(),
      },
      account: {
        aggregate: jest.fn(),
      },
      dailySnapshot: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    }

    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SettlementService,
          useValue: {
            getUnsettledSummary: jest.fn().mockResolvedValue({}),
            runDailySettlement: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile()

    service = module.get(FinanceService)
  })

  describe('getDailySummary', () => {
    it('应按日期分组统计收入、支出、手续费与笔数，并转换为元', async () => {
      prisma.transactionOrder.findMany.mockResolvedValue([
        {
          type: TransactionType.RECHARGE,
          amount: 10000,
          fee: 100,
          completedAt: new Date('2026-06-01T10:00:00.000Z'),
        },
        {
          type: TransactionType.TRANSFER,
          amount: 3000,
          fee: 30,
          completedAt: new Date('2026-06-01T11:00:00.000Z'),
        },
        {
          type: TransactionType.RED_PACKET,
          amount: 5000,
          fee: 50,
          completedAt: new Date('2026-06-02T09:00:00.000Z'),
        },
        {
          type: TransactionType.PAYMENT,
          amount: 2000,
          fee: 20,
          completedAt: new Date('2026-06-02T12:00:00.000Z'),
        },
      ])

      const result = await service.getDailySummary({
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })

      expect(prisma.transactionOrder.findMany).toHaveBeenCalledWith({
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-02T23:59:59.999Z'),
          },
        },
        select: {
          type: true,
          amount: true,
          fee: true,
          completedAt: true,
        },
      })
      expect(result.data).toEqual([
        {
          date: '2026-06-01',
          totalIncome: 10000,
          totalExpense: 3000,
          totalFee: 130,
          transactionCount: 2,
          totalIncomeYuan: '100.00',
          totalExpenseYuan: '30.00',
          totalFeeYuan: '1.30',
        },
        {
          date: '2026-06-02',
          totalIncome: 5000,
          totalExpense: 2000,
          totalFee: 70,
          transactionCount: 2,
          totalIncomeYuan: '50.00',
          totalExpenseYuan: '20.00',
          totalFeeYuan: '0.70',
        },
      ])
    })

    it('无交易时返回空数组', async () => {
      prisma.transactionOrder.findMany.mockResolvedValue([])

      const result = await service.getDailySummary({})

      expect(result.data).toEqual([])
    })
  })

  describe('getMerchantSettlements', () => {
    it('应按 merchantId 分组统计金额、手续费与结算金额，并补充商户信息', async () => {
      prisma.paymentOrder.groupBy.mockResolvedValue([
        {
          merchantId: 'm1',
          _sum: { amount: 50000, fee: 500 },
          _count: { id: 10 },
        },
        {
          merchantId: 'm2',
          _sum: { amount: 30000, fee: 300 },
          _count: { id: 5 },
        },
      ])
      prisma.merchant.findMany.mockResolvedValue([
        {
          id: 'm1',
          merchantNo: 'M001',
          merchantName: '商户一',
        },
        {
          id: 'm2',
          merchantNo: 'M002',
          merchantName: '商户二',
        },
      ])

      const result = await service.getMerchantSettlements({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      })

      expect(prisma.paymentOrder.groupBy).toHaveBeenCalledWith({
        by: ['merchantId'],
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-30T23:59:59.999Z'),
          },
        },
        _sum: { amount: true, fee: true },
        _count: { id: true },
      })
      expect(result.data).toEqual([
        {
          merchantId: 'm1',
          merchantNo: 'M001',
          merchantName: '商户一',
          totalAmount: 50000,
          totalFee: 500,
          settledAmount: 49500,
          orderCount: 10,
          totalAmountYuan: '500.00',
          totalFeeYuan: '5.00',
          settledAmountYuan: '495.00',
        },
        {
          merchantId: 'm2',
          merchantNo: 'M002',
          merchantName: '商户二',
          totalAmount: 30000,
          totalFee: 300,
          settledAmount: 29700,
          orderCount: 5,
          totalAmountYuan: '300.00',
          totalFeeYuan: '3.00',
          settledAmountYuan: '297.00',
        },
      ])
    })

    it('merchantId 为空时应按全部商户统计', async () => {
      prisma.paymentOrder.groupBy.mockResolvedValue([
        {
          merchantId: 'm1',
          _sum: { amount: 10000, fee: 100 },
          _count: { id: 2 },
        },
      ])
      prisma.merchant.findMany.mockResolvedValue([
        { id: 'm1', merchantNo: 'M001', merchantName: '商户一' },
      ])

      const result = await service.getMerchantSettlements({})

      expect(prisma.paymentOrder.groupBy).toHaveBeenCalledWith({
        by: ['merchantId'],
        where: { status: PaymentOrderStatus.PAID },
        _sum: { amount: true, fee: true },
        _count: { id: true },
      })
      expect(result.data).toHaveLength(1)
    })
  })

  describe('getFeeIncome', () => {
    it('应分别按日期统计 paymentFee 与 withdrawalFee，并汇总为 totalFee', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue([
        { fee: 100, paidAt: new Date('2026-06-01T10:00:00.000Z') },
        { fee: 200, paidAt: new Date('2026-06-01T14:00:00.000Z') },
        { fee: 50, paidAt: new Date('2026-06-02T09:00:00.000Z') },
      ])
      prisma.withdrawalOrder.findMany.mockResolvedValue([
        { fee: 30, reviewedAt: new Date('2026-06-01T11:00:00.000Z') },
        { fee: 70, reviewedAt: new Date('2026-06-02T16:00:00.000Z') },
      ])

      const result = await service.getFeeIncome({
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })

      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-02T23:59:59.999Z'),
          },
        },
        select: { fee: true, paidAt: true },
      })
      expect(prisma.withdrawalOrder.findMany).toHaveBeenCalledWith({
        where: {
          status: WithdrawalStatus.SUCCESS,
          reviewedAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-02T23:59:59.999Z'),
          },
        },
        select: { fee: true, reviewedAt: true },
      })
      expect(result.data).toEqual([
        {
          date: '2026-06-01',
          paymentFee: 300,
          withdrawalFee: 30,
          totalFee: 330,
          paymentFeeYuan: '3.00',
          withdrawalFeeYuan: '0.30',
          totalFeeYuan: '3.30',
        },
        {
          date: '2026-06-02',
          paymentFee: 50,
          withdrawalFee: 70,
          totalFee: 120,
          paymentFeeYuan: '0.50',
          withdrawalFeeYuan: '0.70',
          totalFeeYuan: '1.20',
        },
      ])
    })
  })

  describe('generateDailySnapshot', () => {
    it('应聚合总资产、收入、支出、手续费、交易笔数并 upsert DailySnapshot', async () => {
      prisma.account.aggregate.mockResolvedValue({
        _sum: { totalBalance: 1000000 },
      })
      prisma.transactionOrder.aggregate.mockResolvedValueOnce({
        _sum: { amount: 80000 },
      })
      prisma.transactionOrder.aggregate.mockResolvedValueOnce({
        _sum: { amount: 30000 },
      })
      prisma.paymentOrder.aggregate.mockResolvedValue({
        _sum: { fee: 500 },
      })
      prisma.withdrawalOrder.aggregate.mockResolvedValue({
        _sum: { fee: 200 },
      })
      prisma.transactionOrder.count.mockResolvedValue(20)
      prisma.dailySnapshot.upsert.mockResolvedValue({
        id: 's1',
        date: '2026-06-01',
        totalAssets: 1000000,
        totalIncome: 80000,
        totalExpense: 30000,
        totalFee: 700,
        transactionCount: 20,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      })

      const result = await service.generateDailySnapshot('2026-06-01')

      expect(prisma.account.aggregate).toHaveBeenCalledWith({
        _sum: { totalBalance: true },
      })
      expect(prisma.transactionOrder.aggregate).toHaveBeenCalledTimes(2)
      expect(prisma.paymentOrder.aggregate).toHaveBeenCalledWith({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-01T23:59:59.999Z'),
          },
        },
        _sum: { fee: true },
      })
      expect(prisma.withdrawalOrder.aggregate).toHaveBeenCalledWith({
        where: {
          status: WithdrawalStatus.SUCCESS,
          reviewedAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-01T23:59:59.999Z'),
          },
        },
        _sum: { fee: true },
      })
      expect(prisma.dailySnapshot.upsert).toHaveBeenCalledWith({
        where: { date: '2026-06-01' },
        create: {
          date: '2026-06-01',
          totalAssets: 1000000,
          totalIncome: 80000,
          totalExpense: 30000,
          totalFee: 700,
          transactionCount: 20,
        },
        update: {
          totalAssets: 1000000,
          totalIncome: 80000,
          totalExpense: 30000,
          totalFee: 700,
          transactionCount: 20,
        },
      })
      expect(result.totalAssetsYuan).toBe('10000.00')
      expect(result.totalIncomeYuan).toBe('800.00')
      expect(result.totalExpenseYuan).toBe('300.00')
      expect(result.totalFeeYuan).toBe('7.00')
    })
  })

  describe('getDailySnapshots', () => {
    it('应按日期范围过滤快照并转换为元', async () => {
      prisma.dailySnapshot.findMany.mockResolvedValue([
        {
          id: 's1',
          date: '2026-06-02',
          totalAssets: 200000,
          totalIncome: 10000,
          totalExpense: 5000,
          totalFee: 100,
          transactionCount: 5,
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          updatedAt: new Date('2026-06-02T00:00:00.000Z'),
        },
        {
          id: 's2',
          date: '2026-06-01',
          totalAssets: 150000,
          totalIncome: 8000,
          totalExpense: 3000,
          totalFee: 80,
          transactionCount: 3,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ])

      const result = await service.getDailySnapshots({
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })

      expect(prisma.dailySnapshot.findMany).toHaveBeenCalledWith({
        where: {
          date: {
            gte: '2026-06-01',
            lte: '2026-06-02',
          },
        },
        orderBy: { date: 'desc' },
      })
      expect(result.data).toEqual([
        {
          id: 's1',
          date: '2026-06-02',
          totalAssets: 200000,
          totalIncome: 10000,
          totalExpense: 5000,
          totalFee: 100,
          transactionCount: 5,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          totalAssetsYuan: '2000.00',
          totalIncomeYuan: '100.00',
          totalExpenseYuan: '50.00',
          totalFeeYuan: '1.00',
        },
        {
          id: 's2',
          date: '2026-06-01',
          totalAssets: 150000,
          totalIncome: 8000,
          totalExpense: 3000,
          totalFee: 80,
          transactionCount: 3,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          totalAssetsYuan: '1500.00',
          totalIncomeYuan: '80.00',
          totalExpenseYuan: '30.00',
          totalFeeYuan: '0.80',
        },
      ])
    })

    it('无日期范围时不添加 where 条件', async () => {
      prisma.dailySnapshot.findMany.mockResolvedValue([])

      const result = await service.getDailySnapshots({})

      expect(prisma.dailySnapshot.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { date: 'desc' },
      })
      expect(result.data).toEqual([])
    })
  })
})
