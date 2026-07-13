import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  Direction,
  LedgerType,
  PaymentOrderStatus,
  ReconciliationStatus,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { FinanceService } from './finance.service'
import { fenToYuan } from '../common/helpers'
import { escapeCsvField } from '../common/csv'

// 对账摘要结构，便于持久化与接口返回
export interface ReconciliationSummary {
  totalAssets: number
  totalDebit: number
  totalCredit: number
  ledgerNetChange: number
  totalRecharge: number
  totalWithdrawal: number
  totalPaymentFee: number
  totalWithdrawalFee: number
  totalFee: number
  transactionCount: number
  previousTotalAssets: number
  actualAssetsChange: number
  expectedAssetsChange: number
  adjustmentNet: number
  totalAssetsYuan: string
  totalRechargeYuan: string
  totalWithdrawalYuan: string
  totalPaymentFeeYuan: string
  totalFeeYuan: string
}

// 对账差异项结构
interface ReconciliationDifference {
  check: string
  message: string
  [key: string]: unknown
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
  ) {}

  async runReconciliation(date: string, checkedBy?: string) {
    const { start, end } = this.getDateRange(date)

    const [
      accountsAgg,
      ledgerGroups,
      txOrders,
      rechargeAgg,
      paymentAgg,
      withdrawalAgg,
      adjustmentGroups,
    ] = await Promise.all([
      this.prisma.account.aggregate({ _sum: { totalBalance: true } }),
      this.prisma.accountLedger.groupBy({
        by: ['direction'],
        where: { createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.transactionOrder.findMany({
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: { gte: start, lte: end },
        },
        select: { id: true, orderNo: true, type: true, amount: true },
      }),
      this.prisma.transactionOrder.aggregate({
        where: {
          status: TransactionStatus.SUCCESS,
          completedAt: { gte: start, lte: end },
          type: TransactionType.RECHARGE,
        },
        _sum: { amount: true },
      }),
      this.prisma.paymentOrder.aggregate({
        where: {
          // 手续费统计含 REFUNDED 订单：退款只退本金不退手续费，
          // 全额退款后订单 status 变为 REFUNDED 但手续费仍是平台收入，
          // 若仅统计 PAID 会漏算已全额退款订单的手续费，导致对账期望资产变动偏大
          status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] },
          paidAt: { gte: start, lte: end },
        },
        _sum: { fee: true, amount: true },
      }),
      this.prisma.withdrawalOrder.aggregate({
        where: {
          status: WithdrawalStatus.SUCCESS,
          reviewedAt: { gte: start, lte: end },
        },
        _sum: { amount: true, fee: true },
      }),
      this.prisma.accountLedger.groupBy({
        by: ['direction'],
        where: {
          type: LedgerType.ADJUSTMENT,
          createdAt: { gte: start, lte: end },
        },
        _sum: { amount: true },
      }),
    ])

    const totalAssets = accountsAgg._sum.totalBalance || 0
    const totalDebit =
      ledgerGroups.find((g) => g.direction === Direction.DEBIT)?._sum.amount ||
      0
    const totalCredit =
      ledgerGroups.find((g) => g.direction === Direction.CREDIT)?._sum.amount ||
      0
    const ledgerNetChange = totalDebit - totalCredit

    const totalRecharge = rechargeAgg._sum.amount || 0
    const totalPaymentFee = paymentAgg._sum.fee || 0
    const totalWithdrawal = withdrawalAgg._sum.amount || 0
    const totalWithdrawalFee = withdrawalAgg._sum.fee || 0
    const totalFee = totalPaymentFee + totalWithdrawalFee
    const transactionCount = txOrders.length

    // 管理员调账净额：DEBIT（加款）增加平台总资产，CREDIT（扣款）减少平台总资产
    const adjustmentDebit =
      adjustmentGroups.find((g) => g.direction === Direction.DEBIT)?._sum
        .amount || 0
    const adjustmentCredit =
      adjustmentGroups.find((g) => g.direction === Direction.CREDIT)?._sum
        .amount || 0
    const adjustmentNet = adjustmentDebit - adjustmentCredit

    const previousDay = this.getPreviousDate(date)

    // 任务4：对账执行前检查前一日 DailySnapshot 是否存在；
    // 不存在则尝试生成，生成失败则标记对账为「快照缺失」状态
    let previousSnapshot = previousDay
      ? await this.prisma.dailySnapshot.findUnique({
          where: { date: previousDay },
        })
      : null

    if (!previousSnapshot && previousDay) {
      try {
        this.logger.log(
          `前一日 ${previousDay} 快照缺失，尝试补生成快照`,
        )
        await this.financeService.generateDailySnapshot(previousDay)
        previousSnapshot = await this.prisma.dailySnapshot.findUnique({
          where: { date: previousDay },
        })
      } catch (err) {
        this.logger.error(`生成 ${previousDay} 快照失败，对账标记为快照缺失`, err)
        const snapshotMissingReport = await this.prisma.reconciliationReport.upsert(
          {
            where: { date },
            create: {
              date,
              status: ReconciliationStatus.SNAPSHOT_MISSING,
              differences: JSON.stringify([
                {
                  check: 'snapshot_missing',
                  message: `前一日 ${previousDay} 快照缺失且生成失败，无法完成对账`,
                  previousDay,
                },
              ]),
              summary: JSON.stringify({
                date,
                previousDay,
                totalAssets,
                error: 'SNAPSHOT_MISSING',
              }),
              checkedBy,
              checkedAt: new Date(),
            },
            update: {
              status: ReconciliationStatus.SNAPSHOT_MISSING,
              differences: JSON.stringify([
                {
                  check: 'snapshot_missing',
                  message: `前一日 ${previousDay} 快照缺失且生成失败，无法完成对账`,
                  previousDay,
                },
              ]),
              summary: JSON.stringify({
                date,
                previousDay,
                totalAssets,
                error: 'SNAPSHOT_MISSING',
              }),
              checkedBy,
              checkedAt: new Date(),
            },
          },
        )
        // 剥离 Prisma 返回的 Json 类型 summary，避免与本地对象形成联合类型
        const { summary: _smStored, ...smRest } = snapshotMissingReport
        // 快照缺失时无法计算前后对比，但仍返回完整 ReconciliationSummary 结构，
        // 保证返回类型一致（summary 始终为 ReconciliationSummary，不形成联合类型）
        const snapshotMissingSummary: ReconciliationSummary = {
          totalAssets,
          totalDebit,
          totalCredit,
          ledgerNetChange,
          totalRecharge,
          totalWithdrawal,
          totalPaymentFee,
          totalWithdrawalFee,
          totalFee,
          transactionCount,
          previousTotalAssets: 0,
          actualAssetsChange: totalAssets,
          expectedAssetsChange: 0,
          adjustmentNet,
          totalAssetsYuan: fenToYuan(totalAssets),
          totalRechargeYuan: fenToYuan(totalRecharge),
          totalWithdrawalYuan: fenToYuan(totalWithdrawal),
          totalPaymentFeeYuan: fenToYuan(totalPaymentFee),
          totalFeeYuan: fenToYuan(totalFee),
        }
        return {
          ...smRest,
          summary: snapshotMissingSummary,
        }
      }
    }

    const previousTotalAssets = previousSnapshot?.totalAssets || 0
    const actualAssetsChange = totalAssets - previousTotalAssets

    // 仅资金流入/流出会影响平台总资产：
    // 充值 +，提现 -，手续费 -（用户/商户支付的手续费从账户体系中扣除，未单独入账平台账户）
    // 管理员调账 +adjustmentNet（加款增加、扣款减少总资产）
    // 转账、红包、支付、退款在用户/商户账户间流转，净影响为 0
    // 注意：totalWithdrawal 为提现总额（含手续费），approve 已从 totalBalance 扣除全额，
    // 因此不应再单独减去 totalWithdrawalFee，否则会重复扣减手续费
    const expectedAssetsChange =
      totalRecharge - totalWithdrawal - totalPaymentFee + adjustmentNet

    const differences: ReconciliationDifference[] = []

    if (actualAssetsChange !== ledgerNetChange) {
      differences.push({
        check: 'ledger_balance',
        message: `账簿净变动与实际资产变动不一致：账本净变动 = ${ledgerNetChange}，资产变动 = ${actualAssetsChange}`,
        debit: totalDebit,
        credit: totalCredit,
        ledgerNetChange,
        actualAssetsChange,
      })
    }

    const ledgerTxIds = new Set(
      (
        await this.prisma.accountLedger.findMany({
          where: { transactionId: { in: txOrders.map((o) => o.id) } },
          select: { transactionId: true },
        })
      ).map((l) => l.transactionId),
    )
    const missingLedgers = txOrders.filter((o) => !ledgerTxIds.has(o.id))
    if (missingLedgers.length > 0) {
      differences.push({
        check: 'missing_ledger',
        message: `发现 ${missingLedgers.length} 笔成功交易缺少账本记录`,
        orders: missingLedgers.map((o) => o.orderNo),
      })
    }

    if (previousSnapshot && actualAssetsChange !== expectedAssetsChange) {
      differences.push({
        check: 'assets_balance',
        message: `资产变动校验失败：实际变动 ${actualAssetsChange} != 期望变动 ${expectedAssetsChange}`,
        actual: actualAssetsChange,
        expected: expectedAssetsChange,
      })
    }

    const status =
      differences.length === 0
        ? ReconciliationStatus.SUCCESS
        : ReconciliationStatus.FAILED

    const summary: ReconciliationSummary = {
      totalAssets,
      totalDebit,
      totalCredit,
      ledgerNetChange,
      totalRecharge,
      totalWithdrawal,
      totalPaymentFee,
      totalWithdrawalFee,
      totalFee,
      transactionCount,
      previousTotalAssets,
      actualAssetsChange,
      expectedAssetsChange,
      adjustmentNet,
      totalAssetsYuan: fenToYuan(totalAssets),
      totalRechargeYuan: fenToYuan(totalRecharge),
      totalWithdrawalYuan: fenToYuan(totalWithdrawal),
      totalPaymentFeeYuan: fenToYuan(totalPaymentFee),
      totalFeeYuan: fenToYuan(totalFee),
    }

    const report = await this.prisma.reconciliationReport.upsert({
      where: { date },
      create: {
        date,
        status,
        differences:
          differences.length > 0 ? JSON.stringify(differences) : null,
        summary: JSON.stringify(summary),
        checkedBy,
        checkedAt: new Date(),
      },
      update: {
        status,
        differences:
          differences.length > 0 ? JSON.stringify(differences) : null,
        summary: JSON.stringify(summary),
        checkedBy,
        checkedAt: new Date(),
      },
    })

    // 剥离 Prisma 返回的 Json 类型 summary，避免与本地 ReconciliationSummary 形成联合类型
    const { summary: _storedSummary, ...reportWithoutSummary } = report
    const parsedSummary = _storedSummary
      ? (JSON.parse(_storedSummary as string) as ReconciliationSummary)
      : summary
    return {
      ...reportWithoutSummary,
      summary: parsedSummary,
    }
  }

  async getReports(query: { startDate?: string; endDate?: string }) {
    const where: Prisma.ReconciliationReportWhereInput = {}
    if (query.startDate || query.endDate) {
      where.date = {}
      if (query.startDate) where.date.gte = query.startDate
      if (query.endDate) where.date.lte = query.endDate
    }

    const data = await this.prisma.reconciliationReport.findMany({
      where,
      orderBy: { date: 'desc' },
    })

    return { data }
  }

  async getReport(date: string) {
    return this.prisma.reconciliationReport.findUnique({
      where: { date },
    })
  }

  async exportReports(query: {
    startDate?: string
    endDate?: string
  }): Promise<string> {
    const { data } = await this.getReports(query)
    const header = '日期,状态,差异'
    const rows = data.map((item) =>
      [item.date, item.status, this.flattenDifferences(item.differences)]
        .map((f) => escapeCsvField(f))
        .join(','),
    )
    return '\uFEFF' + [header, ...rows].join('\n')
  }

  private flattenDifferences(differences: string | null): string {
    if (!differences) return ''
    try {
      const arr = JSON.parse(differences) as Array<{
        check: string
        message: string
      }>
      return arr.map((d) => `${d.check}: ${d.message}`).join('；')
    } catch {
      return differences
    }
  }

  private getDateRange(date: string) {
    const start = new Date(`${date}T00:00:00.000Z`)
    const end = new Date(`${date}T23:59:59.999Z`)
    return { start, end }
  }

  private getPreviousDate(date: string): string | null {
    const d = new Date(`${date}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) return null
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }

}
