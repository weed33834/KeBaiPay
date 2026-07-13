import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TransactionStatus, PaymentOrderStatus } from '../common/enums'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { RefundRequest, RefundResponse, ChannelConfig } from './payment-channel.interface'
import { generateOrderNo } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { REDIS_LOCK_TTL_SECONDS } from '../common/constants'

/**
 * 统一退款服务
 *
 * 提供：
 * - 统一退款接口（自动路由到对应渠道）
 * - 退款状态查询
 * - 退款回调处理
 * - 退款状态跟踪
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly riskEngine: RiskEngineService,
  ) {}

  /**
   * 发起退款
   *
   * @param orderNo 原支付订单号
   * @param amount  退款金额（分）
   * @param reason  退款原因
   * @param idempotencyKey 幂等键
   */
  async createRefund(
    orderNo: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<{
    refundNo: string
    channelRefundNo: string
    status: string
    message?: string
  }> {
    if (amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_INVALID))
    }

    return this.redis.withLock(`refund:create:${orderNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      // 查找原订单
      const order = await this.prisma.transactionOrder.findUnique({
        where: { orderNo },
      })
      if (!order) {
        throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '原支付订单不存在'))
      }

      // 检查订单状态
      if (order.status !== TransactionStatus.SUCCESS) {
        throw new BadRequestException(kbError(KBErrorCodes.ORDER_NOT_REFUNDABLE, '订单状态不可退款'))
      }

      // 检查退款金额
      const refundableAmount = order.amount - (order.fee || 0)
      if (amount > refundableAmount) {
        throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_EXCEEDED))
      }

      // 幂等检查
      if (idempotencyKey) {
        const existing = await this.prisma.transactionOrder.findFirst({
          where: {
            idempotencyKey,
            type: 'REFUND',
          },
        })
        if (existing) {
          return {
            refundNo: existing.orderNo,
            channelRefundNo: existing.channelOrderNo || '',
            status: existing.status,
          }
        }
      }

      // 获取渠道
      const channel = this.channelRegistry.getChannel(order.channel || 'mock')
      const channelConfig = await this.channelRegistry.getEnabledConfig(order.channel || 'mock')

      const refundNo = generateOrderNo('RF')

      // 创建退款订单（PENDING → PROCESSING → SUCCESS/FAILED）
      const refundOrder = await this.prisma.transactionOrder.create({
        data: {
          orderNo: refundNo,
          type: 'REFUND' as any,
          status: TransactionStatus.PENDING,
          amount,
          toUserId: order.toUserId,
          fromUserId: order.fromUserId,
          channel: order.channel,
          relatedOrderNo: orderNo,
          idempotencyKey,
          remark: reason || '用户退款',
        },
      })

      // 调用渠道退款前先置 PROCESSING，防止 queryRefund 在渠道调用期间重复扣款
      await this.prisma.transactionOrder.update({
        where: { id: refundOrder.id },
        data: { status: TransactionStatus.PROCESSING },
      })

      // 调用渠道退款
      const refundRequest: RefundRequest = {
        orderNo,
        refundNo,
        amount,
        reason: reason || '用户退款',
        channelOrderNo: order.channelOrderNo || orderNo,
        channelConfig: channelConfig.config,
      }

      let refundResult: RefundResponse
      try {
        refundResult = await channel.refund(refundRequest)
      } catch (error) {
        // 渠道退款失败，更新订单状态
        await this.prisma.transactionOrder.update({
          where: { id: refundOrder.id },
          data: {
            status: TransactionStatus.FAILED,
            completedAt: new Date(),
            remark: `退款失败：${error instanceof Error ? error.message : '未知错误'}`,
          },
        })
        throw new BadRequestException(
          kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, `退款渠道调用失败：${error instanceof Error ? error.message : '未知错误'}`),
        )
      }

      // 更新退款订单的渠道退款号
      await this.prisma.transactionOrder.update({
        where: { id: refundOrder.id },
        data: {
          channelOrderNo: refundResult.channelRefundNo,
          status: refundResult.status === 'SUCCESS'
            ? TransactionStatus.SUCCESS
            : refundResult.status === 'FAILED'
              ? TransactionStatus.FAILED
              : TransactionStatus.PENDING,
          completedAt: refundResult.status === 'SUCCESS' || refundResult.status === 'FAILED'
            ? new Date()
            : undefined,
        },
      })

      // 如果退款直接成功，处理资金退回
      if (refundResult.status === 'SUCCESS') {
        await this.processRefundSuccess(refundNo, orderNo, amount, order.toUserId!)
      }

      return {
        refundNo,
        channelRefundNo: refundResult.channelRefundNo,
        status: refundResult.status,
        message: refundResult.message,
      }
    })
  }

  /**
   * 查询退款状态
   */
  async queryRefund(refundNo: string): Promise<{
    refundNo: string
    status: string
    message?: string
  }> {
    const refundOrder = await this.prisma.transactionOrder.findUnique({
      where: { orderNo: refundNo },
    })
    if (!refundOrder) {
      throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '退款订单不存在'))
    }

    if (refundOrder.status === TransactionStatus.SUCCESS || refundOrder.status === TransactionStatus.FAILED) {
      return {
        refundNo,
        status: refundOrder.status,
      }
    }

    // PENDING 表示渠道退款尚未发起，不应查询渠道；只有 PROCESSING 才需要主动查询
    if (refundOrder.status === TransactionStatus.PENDING) {
      return {
        refundNo,
        status: refundOrder.status,
        message: '退款处理中',
      }
    }

    const channel = this.channelRegistry.getChannel(refundOrder.channel || 'mock')
    const channelConfig = await this.channelRegistry.getEnabledConfig(refundOrder.channel || 'mock')

    const queryResult = await channel.queryRefund(
      refundOrder.channelOrderNo || refundNo,
      channelConfig.config,
    )

    // 更新退款状态
    const newStatus = queryResult.status === 'SUCCESS'
      ? TransactionStatus.SUCCESS
      : queryResult.status === 'FAILED'
        ? TransactionStatus.FAILED
        : TransactionStatus.PENDING

    if (newStatus !== refundOrder.status) {
      await this.prisma.transactionOrder.update({
        where: { id: refundOrder.id },
        data: {
          status: newStatus,
          completedAt: newStatus === TransactionStatus.SUCCESS || newStatus === TransactionStatus.FAILED
            ? new Date()
            : undefined,
        },
      })

      // 如果退款成功，处理资金退回
      if (newStatus === TransactionStatus.SUCCESS && refundOrder.relatedOrderNo) {
        const originalOrder = await this.prisma.transactionOrder.findUnique({
          where: { orderNo: refundOrder.relatedOrderNo },
        })
        if (originalOrder) {
          await this.processRefundSuccess(refundNo, refundOrder.relatedOrderNo, refundOrder.amount, originalOrder.toUserId!)
        }
      }
    }

    return {
      refundNo,
      status: queryResult.status,
      message: queryResult.message,
    }
  }

  /**
   * 处理退款回调
   */
  async handleRefundCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const channel = this.channelRegistry.getChannel(channelCode)
    const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    const result = channel.parseRefundCallback(rawBody, headers, channelConfig.config)

    return this.redis.withLock(`refund:callback:${result.refundNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      return this.prisma.$transaction(async (tx) => {
        // 查找退款订单
        const refundOrder = await tx.transactionOrder.findUnique({
          where: { orderNo: result.refundNo },
        })
        if (!refundOrder) {
          throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '退款订单不存在'))
        }

        // 幂等检查
        if (refundOrder.status === TransactionStatus.SUCCESS || refundOrder.status === TransactionStatus.FAILED) {
          return channel.buildRefundCallbackSuccess()
        }

        // 验证渠道
        if (refundOrder.channel !== channelCode) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_MISMATCH))
        }

        // 更新退款状态
        const newStatus = result.status === 'SUCCESS' ? TransactionStatus.SUCCESS : TransactionStatus.FAILED
        await tx.transactionOrder.update({
          where: { id: refundOrder.id },
          data: {
            status: newStatus,
            channelOrderNo: result.channelRefundNo || refundOrder.channelOrderNo,
            completedAt: new Date(),
          },
        })

        // 如果退款成功，处理资金退回
        if (result.status === 'SUCCESS' && refundOrder.relatedOrderNo) {
          const originalOrder = await tx.transactionOrder.findUnique({
            where: { orderNo: refundOrder.relatedOrderNo },
          })
          if (originalOrder && originalOrder.toUserId) {
            // 更新账户余额
            const account = await tx.account.findUnique({
              where: { userId: originalOrder.toUserId },
            })
            if (account) {
              const updatedAccount = await tx.account.update({
                where: { id: account.id },
                data: {
                  availableBalance: { decrement: refundOrder.amount },
                  totalBalance: { decrement: refundOrder.amount },
                },
              })

              // 记录账本
              await tx.accountLedger.create({
                data: {
                  accountId: account.id,
                  transactionId: refundOrder.id,
                  type: 'REFUND' as any,
                  amount: refundOrder.amount,
                  balanceBefore: updatedAccount.availableBalance + refundOrder.amount,
                  balanceAfter: updatedAccount.availableBalance,
                  direction: 'CREDIT' as any,
                  remark: `退款 ${result.refundNo}`,
                },
              })
            }

            // 同步更新对应的 paymentOrder.refundAmount，保证 OpenAPI 查订单能看到退款金额
            if (originalOrder.relatedOrderNo) {
              const paymentOrder = await tx.paymentOrder.findUnique({
                where: { orderNo: originalOrder.relatedOrderNo },
                select: { id: true, amount: true, refundAmount: true },
              })
              if (paymentOrder) {
                const newRefundAmount = (paymentOrder.refundAmount || 0) + refundOrder.amount
                await tx.paymentOrder.update({
                  where: { id: paymentOrder.id },
                  data: {
                    refundAmount: newRefundAmount,
                    refundedAt: new Date(),
                    // 全额退款时标记订单为 REFUNDED 状态
                    status: newRefundAmount >= paymentOrder.amount
                      ? PaymentOrderStatus.REFUNDED
                      : PaymentOrderStatus.PAID,
                  },
                })
              }
            }
          }
        }

        return channel.buildRefundCallbackSuccess()
      })
    })
  }

  /**
   * 退款成功后处理资金退回
   * 用 updateMany 乐观锁防止重复扣款（仅当 status=PROCESSING 时才扣）
   */
  private async processRefundSuccess(
    refundNo: string,
    originalOrderNo: string,
    amount: number,
    userId: string,
  ): Promise<void> {
    await this.redis.withLock(`refund:process:${refundNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      // 幂等检查：只有 PROCESSING 状态才处理，已成功的跳过
      const refundOrder = await this.prisma.transactionOrder.findUnique({
        where: { orderNo: refundNo },
        select: { id: true, status: true, relatedOrderNo: true },
      })
      if (!refundOrder) {
        this.logger.error(`退款成功但退款订单不存在: ${refundNo}`)
        return
      }
      if (refundOrder.status === TransactionStatus.SUCCESS) {
        this.logger.warn(`退款 ${refundNo} 已处理过资金退回，跳过重复扣款`)
        return
      }

      const account = await this.prisma.account.findUnique({
        where: { userId },
      })
      if (!account) {
        this.logger.error(`退款成功但用户账户不存在: ${userId}`)
        return
      }

      await this.prisma.$transaction(async (tx) => {
        // 乐观锁：仅当 status=PROCESSING 时更新为 SUCCESS，防止并发重复扣款
        const updated = await tx.transactionOrder.updateMany({
          where: { id: refundOrder.id, status: TransactionStatus.PROCESSING },
          data: { status: TransactionStatus.SUCCESS, completedAt: new Date() },
        })
        if (updated.count === 0) {
          // 状态已变更（可能已被其他流程处理），跳过
          return
        }

        const updatedAccount = await tx.account.update({
          where: { id: account.id },
          data: {
            availableBalance: { decrement: amount },
            totalBalance: { decrement: amount },
          },
        })

        await tx.accountLedger.create({
          data: {
            accountId: account.id,
            transactionId: refundNo,
            type: 'REFUND' as any,
            amount,
            balanceBefore: updatedAccount.availableBalance + amount,
            balanceAfter: updatedAccount.availableBalance,
            direction: 'CREDIT' as any,
            remark: `退款 ${refundNo}（原订单 ${originalOrderNo}）`,
          },
        })

        // 同步更新对应的 paymentOrder.refundAmount（原支付单 -> 商户订单）
        if (refundOrder.relatedOrderNo) {
          const originalTxOrder = await tx.transactionOrder.findUnique({
            where: { orderNo: refundOrder.relatedOrderNo },
            select: { relatedOrderNo: true },
          })
          if (originalTxOrder?.relatedOrderNo) {
            const paymentOrder = await tx.paymentOrder.findUnique({
              where: { orderNo: originalTxOrder.relatedOrderNo },
              select: { id: true, amount: true, refundAmount: true },
            })
            if (paymentOrder) {
              const newRefundAmount = (paymentOrder.refundAmount || 0) + amount
              await tx.paymentOrder.update({
                where: { id: paymentOrder.id },
                data: {
                  refundAmount: newRefundAmount,
                  refundedAt: new Date(),
                  status: newRefundAmount >= paymentOrder.amount
                    ? PaymentOrderStatus.REFUNDED
                    : PaymentOrderStatus.PAID,
                },
              })
            }
          }
        }
      })
      // 退款成功后记录风控频率（不阻塞业务）
      this.riskEngine.recordTransaction({
        userId,
        type: 'REFUND',
        amount,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(REFUND) 失败: ${err?.message || err}`)
      })
    })
  }

  /**
   * 获取退款统计信息
   */
  async getRefundStats(userId: string): Promise<{
    totalRefunds: number
    totalRefundAmount: number
    pendingRefunds: number
  }> {
    const [totalRefunds, amountResult, pendingRefunds] = await Promise.all([
      this.prisma.transactionOrder.count({
        where: {
          type: 'REFUND' as any,
          toUserId: userId,
        },
      }),
      this.prisma.transactionOrder.aggregate({
        _sum: { amount: true },
        where: {
          type: 'REFUND' as any,
          toUserId: userId,
          status: TransactionStatus.SUCCESS,
        },
      }),
      this.prisma.transactionOrder.count({
        where: {
          type: 'REFUND' as any,
          toUserId: userId,
          status: TransactionStatus.PENDING,
        },
      }),
    ])

    return {
      totalRefunds,
      totalRefundAmount: amountResult._sum.amount || 0,
      pendingRefunds,
    }
  }
}
