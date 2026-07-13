import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  PaymentOrderStatus,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { fenToYuan } from '../common/helpers'
import { escapeCsvField } from '../common/csv'
import { SettlementService } from '../notifications/settlement.service'

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
  ) {}

  async getDailySummary(query: { startDate?: string; endDate?: string }) {
    const { start, end } = this.getRange(query.startDate, query.endDate)

    const orders = await this.prisma.transactionOrder.findMany({
      where: {
        status: TransactionStatus.SUCCESS,
        completedAt: { gte: start, lte: end },
      },
      select: {
        type: true,
        amount: true,
        fee: true,
        completedAt: true,
      },
    })

    const map = new Map<
      string,
      {
        totalIncome: number
        totalExpense: number
        totalFee: number
        transactionCount: number
      }
    >()

    for (const order of orders) {
      const date = this.formatDate(order.completedAt!)
      if (!map.has(date)) {
        map.set(date, {
          totalIncome: 0,
          totalExpense: 0,
          totalFee: 0,
          transactionCount: 0,
        })
      }
      const item = map.get(date)!
      item.totalFee += order.fee
      item.transactionCount += 1
      if (this.isIncomeType(order.type as TransactionType)) {
        item.totalIncome += order.amount
      } else if (this.isExpenseType(order.type as TransactionType)) {
        item.totalExpense += order.amount
      }
    }

    const data = Array.from(map.entries())
      .map(([date, item]) => ({
        date,
        ...item,
        totalIncomeYuan: fenToYuan(item.totalIncome),
        totalExpenseYuan: fenToYuan(item.totalExpense),
        totalFeeYuan: fenToYuan(item.totalFee),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return { data }
  }

  async getMerchantSettlements(query: {
    merchantId?: string
    startDate?: string
    endDate?: string
  }) {
    const { start, end } = this.getRange(query.startDate, query.endDate)
    const where: Prisma.PaymentOrderWhereInput = { status: PaymentOrderStatus.PAID }
    if (query.merchantId) {
      where.merchantId = query.merchantId
    }
    if (start && end) {
      where.paidAt = { gte: start, lte: end }
    }

    const groups = await this.prisma.paymentOrder.groupBy({
      by: ['merchantId'],
      where,
      _sum: { amount: true, fee: true },
      _count: { id: true },
    })

    const merchantIds = groups.map((g) => g.merchantId)
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, merchantNo: true, merchantName: true },
    })
    const merchantMap = new Map(merchants.map((m) => [m.id, m]))

    const data = groups.map((g) => {
      const totalAmount = g._sum.amount || 0
      const totalFee = g._sum.fee || 0
      const settledAmount = totalAmount - totalFee
      const merchant = merchantMap.get(g.merchantId)
      return {
        merchantId: g.merchantId,
        merchantNo: merchant?.merchantNo || '',
        merchantName: merchant?.merchantName || '',
        totalAmount,
        totalFee,
        settledAmount,
        orderCount: g._count.id,
        totalAmountYuan: fenToYuan(totalAmount),
        totalFeeYuan: fenToYuan(totalFee),
        settledAmountYuan: fenToYuan(settledAmount),
      }
    })

    return { data }
  }

  async getFeeIncome(query: { startDate?: string; endDate?: string }) {
    const { start, end } = this.getRange(query.startDate, query.endDate)

    const [payments, withdrawals] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: { gte: start, lte: end },
        },
        select: { fee: true, paidAt: true },
      }),
      this.prisma.withdrawalOrder.findMany({
        where: {
          status: WithdrawalStatus.SUCCESS,
          reviewedAt: { gte: start, lte: end },
        },
        select: { fee: true, reviewedAt: true },
      }),
    ])

    const map = new Map<
      string,
      { paymentFee: number; withdrawalFee: number; totalFee: number }
    >()

    for (const item of payments) {
      const date = this.formatDate(item.paidAt!)
      this.ensureFeeEntry(map, date)
      const entry = map.get(date)!
      entry.paymentFee += item.fee
      entry.totalFee += item.fee
    }

    for (const item of withdrawals) {
      const date = this.formatDate(item.reviewedAt!)
      this.ensureFeeEntry(map, date)
      const entry = map.get(date)!
      entry.withdrawalFee += item.fee
      entry.totalFee += item.fee
    }

    const data = Array.from(map.entries())
      .map(([date, item]) => ({
        date,
        ...item,
        paymentFeeYuan: fenToYuan(item.paymentFee),
        withdrawalFeeYuan: fenToYuan(item.withdrawalFee),
        totalFeeYuan: fenToYuan(item.totalFee),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return { data }
  }

  async generateDailySnapshot(date: string) {
    const { start, end } = this.getDateRange(date)

    const [
      accountsAgg,
      incomeAgg,
      expenseAgg,
      paymentFeeAgg,
      withdrawalFeeAgg,
      transactionCount,
    ] = await Promise.all([
      this.prisma.account.aggregate({ _sum: { totalBalance: true } }),
      this.prisma.transactionOrder.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: { gte: start, lte: end },
          type: { in: this.incomeTypes() },
        },
        _sum: { amount: true },
      }),
      this.prisma.transactionOrder.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: { gte: start, lte: end },
          type: { in: this.expenseTypes() },
        },
        _sum: { amount: true },
      }),
      this.prisma.paymentOrder.aggregate({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: { gte: start, lte: end },
        },
        _sum: { fee: true },
      }),
      this.prisma.withdrawalOrder.aggregate({
        where: {
          status: WithdrawalStatus.SUCCESS,
          reviewedAt: { gte: start, lte: end },
        },
        _sum: { fee: true },
      }),
      this.prisma.transactionOrder.count({
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: { gte: start, lte: end },
        },
      }),
    ])

    const totalAssets = accountsAgg._sum.totalBalance || 0
    const totalIncome = incomeAgg._sum.amount || 0
    const totalExpense = expenseAgg._sum.amount || 0
    const totalFee =
      (paymentFeeAgg._sum.fee || 0) + (withdrawalFeeAgg._sum.fee || 0)

    const snapshot = await this.prisma.dailySnapshot.upsert({
      where: { date },
      create: {
        date,
        totalAssets,
        totalIncome,
        totalExpense,
        totalFee,
        transactionCount,
      },
      update: {
        totalAssets,
        totalIncome,
        totalExpense,
        totalFee,
        transactionCount,
      },
    })

    return {
      ...snapshot,
      totalAssetsYuan: fenToYuan(snapshot.totalAssets),
      totalIncomeYuan: fenToYuan(snapshot.totalIncome),
      totalExpenseYuan: fenToYuan(snapshot.totalExpense),
      totalFeeYuan: fenToYuan(snapshot.totalFee),
    }
  }

  async getDailySnapshots(query: { startDate?: string; endDate?: string }) {
    const where: Prisma.DailySnapshotWhereInput = {}
    if (query.startDate || query.endDate) {
      where.date = {}
      if (query.startDate) where.date.gte = query.startDate
      if (query.endDate) where.date.lte = query.endDate
    }

    const data = await this.prisma.dailySnapshot.findMany({
      where,
      orderBy: { date: 'desc' },
    })

    return {
      data: data.map((s) => ({
        ...s,
        totalAssetsYuan: fenToYuan(s.totalAssets),
        totalIncomeYuan: fenToYuan(s.totalIncome),
        totalExpenseYuan: fenToYuan(s.totalExpense),
        totalFeeYuan: fenToYuan(s.totalFee),
      })),
    }
  }

  async getOverview(query: { startDate?: string; endDate?: string }) {
    const { start, end } = this.getOverviewRange(query.startDate, query.endDate)

    // 单次 groupBy 按 type 聚合，替代原 4 次独立 aggregate（turnover/income/expense/count）
    const incomeTypeSet = new Set(this.incomeTypes())
    const expenseTypeSet = new Set(this.expenseTypes())

    const [
      txGroups,
      paymentFeeAgg,
      withdrawalFeeAgg,
      accountsAgg,
    ] = await Promise.all([
      this.prisma.transactionOrder.groupBy({
        by: ['type'],
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: { gte: start, lte: end },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.paymentOrder.aggregate({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: { gte: start, lte: end },
        },
        _sum: { fee: true },
      }),
      this.prisma.withdrawalOrder.aggregate({
        where: {
          status: WithdrawalStatus.SUCCESS,
          reviewedAt: { gte: start, lte: end },
        },
        _sum: { fee: true },
      }),
      this.prisma.account.aggregate({ _sum: { totalBalance: true } }),
    ])

    let totalTurnover = 0
    let totalIncome = 0
    let totalExpense = 0
    let transactionCount = 0
    for (const g of txGroups) {
      const amount = g._sum.amount || 0
      totalTurnover += amount
      transactionCount += g._count.id
      if (incomeTypeSet.has(g.type as TransactionType)) {
        totalIncome += amount
      } else if (expenseTypeSet.has(g.type as TransactionType)) {
        totalExpense += amount
      }
    }

    const totalFee =
      (paymentFeeAgg._sum.fee || 0) + (withdrawalFeeAgg._sum.fee || 0)
    const netIncome = totalFee
    const totalAssets = accountsAgg._sum.totalBalance || 0

    return {
      totalTurnover,
      totalIncome,
      totalExpense,
      totalFee,
      netIncome,
      totalAssets,
      transactionCount,
      totalTurnoverYuan: fenToYuan(totalTurnover),
      totalIncomeYuan: fenToYuan(totalIncome),
      totalExpenseYuan: fenToYuan(totalExpense),
      totalFeeYuan: fenToYuan(totalFee),
      netIncomeYuan: fenToYuan(netIncome),
      totalAssetsYuan: fenToYuan(totalAssets),
    }
  }

  async exportDailySummary(query: {
    startDate?: string
    endDate?: string
  }): Promise<string> {
    const { data } = await this.getDailySummary(query)
    const header = '日期,收入(元),支出(元),手续费(元),交易笔数'
    const rows = data.map((item) =>
      [
        item.date,
        item.totalIncomeYuan,
        item.totalExpenseYuan,
        item.totalFeeYuan,
        item.transactionCount,
      ]
        .map((f) => escapeCsvField(f))
        .join(','),
    )
    return '\uFEFF' + [header, ...rows].join('\n')
  }

  async exportMerchantSettlements(query: {
    merchantId?: string
    startDate?: string
    endDate?: string
  }): Promise<string> {
    const { data } = await this.getMerchantSettlements(query)
    const header =
      '商户编号,商户名称,交易总额(元),手续费(元),结算金额(元),订单数'
    const rows = data.map((item) =>
      [
        item.merchantNo,
        item.merchantName,
        item.totalAmountYuan,
        item.totalFeeYuan,
        item.settledAmountYuan,
        item.orderCount,
      ]
        .map((f) => escapeCsvField(f))
        .join(','),
    )
    return '\uFEFF' + [header, ...rows].join('\n')
  }

  async exportFeeIncome(query: {
    startDate?: string
    endDate?: string
  }): Promise<string> {
    const { data } = await this.getFeeIncome(query)
    const header = '日期,支付手续费(元),提现手续费(元),手续费合计(元)'
    const rows = data.map((item) =>
      [
        item.date,
        item.paymentFeeYuan,
        item.withdrawalFeeYuan,
        item.totalFeeYuan,
      ]
        .map((f) => escapeCsvField(f))
        .join(','),
    )
    return '\uFEFF' + [header, ...rows].join('\n')
  }

  async exportDailySnapshots(query: {
    startDate?: string
    endDate?: string
  }): Promise<string> {
    const { data } = await this.getDailySnapshots(query)
    const header =
      '日期,总资产(元),总收入(元),总支出(元),手续费(元),交易笔数'
    const rows = data.map((item) =>
      [
        item.date,
        item.totalAssetsYuan,
        item.totalIncomeYuan,
        item.totalExpenseYuan,
        item.totalFeeYuan,
        item.transactionCount,
      ]
        .map((f) => escapeCsvField(f))
        .join(','),
    )
    return '\uFEFF' + [header, ...rows].join('\n')
  }

  private getOverviewRange(startDate?: string, endDate?: string) {
    if (startDate && endDate) {
      return {
        start: new Date(`${startDate}T00:00:00.000Z`),
        end: new Date(`${endDate}T23:59:59.999Z`),
      }
    }
    const today = new Date()
    const start = new Date(today)
    start.setUTCDate(start.getUTCDate() - 6)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(`${today.toISOString().slice(0, 10)}T23:59:59.999Z`)
    return { start, end }
  }

  private getRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) {
      return { start: undefined, end: undefined }
    }
    const start = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : new Date('1970-01-01T00:00:00.000Z')
    const end = endDate
      ? new Date(`${endDate}T23:59:59.999Z`)
      : new Date(`${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`)
    return { start, end }
  }

  private getDateRange(date: string) {
    const start = new Date(`${date}T00:00:00.000Z`)
    const end = new Date(`${date}T23:59:59.999Z`)
    return { start, end }
  }

  private formatDate(date: Date) {
    return new Date(date).toISOString().slice(0, 10)
  }

  private incomeTypes(): TransactionType[] {
    return [TransactionType.RECHARGE, TransactionType.RED_PACKET, TransactionType.REFUND]
  }

  private expenseTypes(): TransactionType[] {
    return [TransactionType.TRANSFER, TransactionType.WITHDRAW, TransactionType.PAYMENT]
  }

  private isIncomeType(type: TransactionType) {
    return this.incomeTypes().includes(type)
  }

  private isExpenseType(type: TransactionType) {
    return this.expenseTypes().includes(type)
  }

  private ensureFeeEntry(
    map: Map<string, { paymentFee: number; withdrawalFee: number; totalFee: number }>,
    date: string,
  ) {
    if (!map.has(date)) {
      map.set(date, { paymentFee: 0, withdrawalFee: 0, totalFee: 0 })
    }
  }

  async getUnsettledSummary() {
    return this.settlement.getUnsettledSummary()
  }

  async runManualSettlement() {
    this.logger.log('手动触发 T+1 结算')
    return this.settlement.runDailySettlement()
  }
}
