import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TransactionStatus } from '../common/enums'
import { RedisService } from '../redis/redis.service'
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

      // 创建退款订单
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
          }
        }

        return channel.buildRefundCallbackSuccess()
      })
    })
  }

  /**
   * 退款成功后处理资金退回
   */
  private async processRefundSuccess(
    refundNo: string,
    originalOrderNo: string,
    amount: number,
    userId: string,
  ): Promise<void> {
    await this.redis.withLock(`refund:process:${refundNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      const account = await this.prisma.account.findUnique({
        where: { userId },
      })
      if (!account) {
        this.logger.error(`退款成功但用户账户不存在: ${userId}`)
        return
      }

      await this.prisma.$transaction(async (tx) => {
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
