import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from './notifications.service'
import { formatDate, getPreviousDate, getDateRange } from '../common/date-helpers'

export interface SettlementResult {
  merchantId: string
  merchantName: string
  orderCount: number
  totalAmount: number
  totalFee: number
  settleAmount: number
  status: 'SUCCESS' | 'SKIPPED' | 'ERROR'
  reason?: string
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * T+1 结算：结算昨天已支付的订单
   * 逻辑：
   * 1. 查找昨天所有已支付且未结算的订单
   * 2. 按商户分组计算结算金额（总金额 - 手续费）
   * 3. 更新订单的结算标记
   * 4. 通知商户
   */
  async runDailySettlement(): Promise<SettlementResult[]> {
    const results: SettlementResult[] = []
    // 统一使用 UTC 日界，避免 setHours(0,0,0,0) 的本地时区漂移导致漏结/多结
    const yesterdayStr = getPreviousDate(formatDate(new Date()))
    const { start: yesterday, end: yesterdayEnd } = getDateRange(yesterdayStr, yesterdayStr)

    this.logger.log(`开始 T+1 结算，结算日期: ${yesterdayStr}`)

    // 查找昨天已支付但未结算的订单
    const unpaidSettlements = await this.prisma.paymentOrder.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: yesterday, lte: yesterdayEnd },
        settledAt: null,
      },
      include: { merchant: true },
    })

    if (unpaidSettlements.length === 0) {
      this.logger.log('没有需要结算的订单')
      return results
    }

    // 按商户分组
    const merchantGroups = new Map<string, typeof unpaidSettlements>()
    for (const order of unpaidSettlements) {
      const key = order.merchantId
      if (!merchantGroups.has(key)) merchantGroups.set(key, [])
      merchantGroups.get(key)!.push(order)
    }

    // 逐商户结算
    for (const [merchantId, orders] of merchantGroups) {
      try {
        const merchant = orders[0].merchant
        const totalAmount = orders.reduce((sum, o) => sum + o.amount, 0)
        const totalFee = orders.reduce((sum, o) => sum + o.fee, 0)
        const settleAmount = totalAmount - totalFee

        // 更新订单结算标记
        await this.prisma.paymentOrder.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { settledAt: new Date() },
        })

        // 在账本中记录商户应收款
        await this.recordSettlementLedger(merchantId, settleAmount)

        // 发送结算通知
        const merchantUser = await this.prisma.user.findUnique({
          where: { id: merchant.userId },
        })
        if (merchantUser?.email) {
          await this.notifications.notifySettlementComplete(
            merchantUser.email,
            merchant.merchantName,
            (settleAmount / 100).toFixed(2),
            yesterday.toISOString().split('T')[0],
          )
        }

        const result: SettlementResult = {
          merchantId,
          merchantName: merchant.merchantName,
          orderCount: orders.length,
          totalAmount,
          totalFee,
          settleAmount,
          status: 'SUCCESS',
        }
        results.push(result)
        this.logger.log(
          `商户 ${merchant.merchantName} 结算完成: ${orders.length} 笔, ` +
          `总金额 ¥${(totalAmount / 100).toFixed(2)}, ` +
          `手续费 ¥${(totalFee / 100).toFixed(2)}, ` +
          `结算 ¥${(settleAmount / 100).toFixed(2)}`,
        )
      } catch (err) {
        const result: SettlementResult = {
          merchantId,
          merchantName: orders[0].merchant.merchantName,
          orderCount: orders.length,
          totalAmount: orders.reduce((s, o) => s + o.amount, 0),
          totalFee: orders.reduce((s, o) => s + o.fee, 0),
          settleAmount: 0,
          status: 'ERROR',
          reason: (err as Error).message,
        }
        results.push(result)
        this.logger.error(`商户 ${result.merchantName} 结算失败: ${result.reason}`)
      }
    }

    this.logger.log(`T+1 结算完成，共处理 ${results.length} 个商户`)
    return results
  }

  private async recordSettlementLedger(merchantId: string, amount: number) {
    await this.prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { id: merchantId } })
      if (!merchant) return

      const account = await tx.account.findUnique({ where: { userId: merchant.userId } })
      if (!account) return

      const balanceBefore = account.availableBalance
      const balanceAfter = balanceBefore + amount
      await tx.account.update({
        where: { id: account.id },
        data: {
          availableBalance: { increment: amount },
          totalBalance: { increment: amount },
        },
      })

      await tx.accountLedger.create({
        data: {
          accountId: account.id,
          transactionId: `SETTLE_${merchantId}_${Date.now()}`,
          type: 'SETTLEMENT',
          amount,
          balanceBefore,
          balanceAfter,
          direction: 'IN',
          remark: `T+1结算 - 商户 ${merchantId}`,
        },
      })

      const platformAccount = await tx.platformAccount.findUnique({
        where: { code: 'MERCHANT_PAYABLE' },
      })
      if (platformAccount) {
        await tx.platformAccount.update({
          where: { id: platformAccount.id },
          data: { balance: platformAccount.balance - amount },
        })
      }
    })
  }

  async getUnsettledSummary() {
    const grouped = await this.prisma.paymentOrder.groupBy({
      by: ['merchantId'],
      where: { status: 'PAID', settledAt: null },
      _count: { id: true },
      _sum: { amount: true, fee: true },
    })

    if (grouped.length === 0) {
      return { totalCount: 0, totalAmount: 0, merchants: [] }
    }

    const merchantIds = grouped.map((g) => g.merchantId)
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, merchantName: true },
    })
    const merchantNameMap = new Map(merchants.map((m) => [m.id, m.merchantName]))

    const totalCount = grouped.reduce((s, g) => s + g._count.id, 0)
    const totalAmount = grouped.reduce((s, g) => s + (g._sum.amount || 0), 0)

    return {
      totalCount,
      totalAmount,
      merchants: grouped.map((g) => ({
        merchantId: g.merchantId,
        merchantName: merchantNameMap.get(g.merchantId) || '',
        count: g._count.id,
        amount: g._sum.amount || 0,
        fee: g._sum.fee || 0,
        settleAmount: (g._sum.amount || 0) - (g._sum.fee || 0),
      })),
    }
  }
}
