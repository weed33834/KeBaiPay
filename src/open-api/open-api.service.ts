import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import {
  MerchantStatus,
  PaymentOrderStatus,
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  UserStatus,
  AccountStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { fenToYuan, generateOrderNo, generatePaymentNo, isCallbackUrlSafe, yuanToFen } from '../common/helpers'
import { kbError, KBErrorCodes } from '../common/error-codes'
import {
  MAX_ORDER_EXPIRY_MS,
  ORDER_EXPIRY_MS,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'
import { MerchantApp } from './open-api.types'

@Injectable()
export class OpenApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly riskEngine: RiskEngineService,
  ) {}

  private getCashierBaseUrl(): string {
    return (
      this.configService.get<string>('CASHIER_BASE_URL') ||
      'http://localhost:3000'
    )
  }

  async createOrder(
    app: MerchantApp,
    dto: {
      merchantOrderNo: string
      amount: number
      subject: string
      body?: string
      callbackUrl?: string
      expiredAt?: string
    },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: app.merchantId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.ORDER_AMOUNT_INVALID))
    }
    const amount = yuanToFen(dto.amount)

    // 幂等：命中已有订单直接返回，不抛错
    const existing = await this.prisma.paymentOrder.findFirst({
      where: {
        merchantId: merchant.id,
        merchantOrderNo: dto.merchantOrderNo,
      },
    })
    if (existing) {
      // 跨 appId 信息泄露防护：仅同一 app 可幂等返回
      if (existing.appId !== app.appId) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订单'))
      }
      return this.formatOrderResponse({ ...existing, status: existing.status as PaymentOrderStatus })
    }

    const expiredAt = dto.expiredAt
      ? new Date(dto.expiredAt)
      : new Date(Date.now() + ORDER_EXPIRY_MS)
    if (isNaN(expiredAt.getTime())) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '过期时间格式无效'))
    }
    if (expiredAt <= new Date()) {
      throw new BadRequestException(kbError(KBErrorCodes.EXPIRED_TIME_INVALID))
    }
    if (expiredAt > new Date(Date.now() + MAX_ORDER_EXPIRY_MS)) {
      throw new BadRequestException(kbError(KBErrorCodes.ORDER_EXPIRED_TIME_TOO_LATE))
    }

    if (dto.callbackUrl) {
      await this.validateCallbackUrl(dto.callbackUrl)
    }

    const orderNo = generatePaymentNo()

    try {
      const order = await this.prisma.paymentOrder.create({
        data: {
          merchantId: merchant.id,
          appId: app.appId,
          merchantOrderNo: dto.merchantOrderNo,
          orderNo,
          amount,
          subject: dto.subject,
          body: dto.body,
          callbackUrl: dto.callbackUrl,
          expiredAt,
        },
      })

      return this.formatOrderResponse({ ...order, status: order.status as PaymentOrderStatus })
    } catch (e) {
      // 并发场景下唯一约束冲突：查回原订单幂等返回
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existed = await this.prisma.paymentOrder.findFirst({
          where: {
            merchantId: merchant.id,
            merchantOrderNo: dto.merchantOrderNo,
          },
        })
        if (existed) return this.formatOrderResponse({ ...existed, status: existed.status as PaymentOrderStatus })
      }
      throw e
    }
  }

  async getOrder(app: MerchantApp, orderNo: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    if (order.appId !== app.appId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查询该订单'))
    }

    return {
      ...order,
      amountYuan: fenToYuan(order.amount),
      feeYuan: fenToYuan(order.fee),
      refundAmountYuan: fenToYuan(order.refundAmount),
    }
  }

  // 退款：全额退本金不退手续费
  async refund(
    app: MerchantApp,
    dto: {
      orderNo: string
      amount?: number
      reason?: string
      idempotencyKey?: string
    },
  ) {
    return this.redis.withLock(`refund:${dto.orderNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      return this.prisma.$transaction(async (tx) => {
        // 事务内重新读取订单，避免外部读取的脏数据
        const order = await tx.paymentOrder.findUnique({
          where: { orderNo: dto.orderNo },
          include: { merchant: true },
        })
        if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
        if (order.appId !== app.appId) {
          throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订单'))
        }
        if (order.status !== PaymentOrderStatus.PAID) {
          throw new BadRequestException(kbError(KBErrorCodes.ORDER_NOT_REFUNDABLE))
        }

        // 基于事务内最新 refundAmount 计算可退金额，防止并发双退
        const currentRefunded = order.refundAmount || 0
        const refundable = order.amount - currentRefunded
        if (refundable <= 0) {
          throw new BadRequestException(kbError(KBErrorCodes.ORDER_FULLY_REFUNDED))
        }

        const refundAmount = dto.amount ? yuanToFen(dto.amount) : refundable
        if (refundAmount <= 0) {
          throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_INVALID))
        }
        if (refundAmount > refundable) {
          throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_EXCEEDED))
        }

        const newRefundAmount = currentRefunded + refundAmount

        // 幂等：命中已有交易直接返回
        if (dto.idempotencyKey) {
          const existing = await tx.transactionOrder.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          })
          if (existing) return existing
        }

        // 风控检查：付款方收款风控
        if (order.payerId) {
          const riskResult = await this.riskEngine.check({
            userId: order.payerId,
            type: 'REFUND',
            amount: refundAmount,
          })
          if (riskResult.blocked) {
            throw new ForbiddenException(
              kbError(
                KBErrorCodes.FORBIDDEN,
                `退款被风控拦截：${riskResult.rules
                  .filter((r) => r.action === 'BLOCK')
                  .map((r) => r.name)
                  .join('、')}`,
              ),
            )
          }
        }

        const merchantUser = await tx.user.findUnique({
          where: { id: order.merchant.userId },
          select: { nickname: true },
        })
        let payerNickname: string | null = null
        if (order.payerId) {
          const payerUser = await tx.user.findUnique({
            where: { id: order.payerId },
            select: { nickname: true },
          })
          payerNickname = payerUser?.nickname || null
        }

        const merchantAccount = await tx.account.findUnique({
          where: { userId: order.merchant.userId },
        })
        if (!merchantAccount) {
          throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '商户账户不存在'))
        }

        const deductResult = await tx.account.updateMany({
          where: {
            id: merchantAccount.id,
            availableBalance: { gte: refundAmount },
          },
          data: {
            availableBalance: { decrement: refundAmount },
            totalBalance: { decrement: refundAmount },
          },
        })
        if (deductResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE, '商户余额不足'))
        }

        // H3: updateMany 不返回更新后的记录，重新读取真实余额以保证账本 balanceBefore/After 准确
        const updatedMerchantAccount = await tx.account.findUnique({
          where: { id: merchantAccount.id },
        })

        let payerAccount = null
        if (order.payerId) {
          payerAccount = await tx.account.findUnique({
            where: { userId: order.payerId },
          })
          if (!payerAccount) {
            throw new BadRequestException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '付款方账户不存在，无法退款'))
          }
        }

        const txOrder = await tx.transactionOrder.create({
          data: {
            orderNo: generateOrderNo('R'),
            type: TransactionType.REFUND,
            status: TransactionStatus.SUCCESS,
            amount: refundAmount,
            fromUserId: order.merchant.userId,
            toUserId: order.payerId,
            remark: dto.reason || `退款 ${order.orderNo}`,
            relatedOrderNo: order.orderNo,
            idempotencyKey: dto.idempotencyKey,
            completedAt: new Date(),
          },
        })

        let updatedPayerAccount: { availableBalance: number } | null = null
        if (payerAccount) {
          updatedPayerAccount = await tx.account.update({
            where: { id: payerAccount.id },
            data: {
              availableBalance: { increment: refundAmount },
              totalBalance: { increment: refundAmount },
            },
          })
        }

        await tx.accountLedger.create({
          data: {
            accountId: merchantAccount.id,
            transactionId: txOrder.id,
            type: LedgerType.REFUND,
            amount: refundAmount,
            // H3: 由重读的真实余额反推，避免陈旧读取
            balanceBefore: updatedMerchantAccount!.availableBalance + refundAmount,
            balanceAfter: updatedMerchantAccount!.availableBalance,
            direction: Direction.CREDIT,
            remark: `退款 ${order.orderNo}`,
          },
        })

        if (payerAccount && updatedPayerAccount) {
          await tx.accountLedger.create({
            data: {
              accountId: payerAccount.id,
              transactionId: txOrder.id,
              type: LedgerType.REFUND,
              amount: refundAmount,
              // H3: 由更新后真实余额反推
              balanceBefore: updatedPayerAccount.availableBalance - refundAmount,
              balanceAfter: updatedPayerAccount.availableBalance,
              direction: Direction.DEBIT,
              remark: `退款入账 ${order.orderNo}`,
            },
          })
        }

        await tx.bill.create({
          data: {
            userId: order.merchant.userId,
            transactionId: txOrder.id,
            type: BillType.REFUND,
            direction: BillDirection.EXPENSE,
            amount: refundAmount,
            counterparty: payerNickname || order.payerId || '付款方',
            remark: `退款 ${order.orderNo}`,
          },
        })

        if (order.payerId) {
          await tx.bill.create({
            data: {
              userId: order.payerId,
              transactionId: txOrder.id,
              type: BillType.REFUND,
              direction: BillDirection.INCOME,
              amount: refundAmount,
              counterparty: merchantUser?.nickname || order.merchant.merchantName,
              remark: `退款入账 ${order.orderNo}`,
            },
          })
        }

        // 乐观锁更新订单：仅当 refundAmount 仍为事务内读取值时才更新成功
        const updateResult = await tx.paymentOrder.updateMany({
          where: {
            id: order.id,
            status: PaymentOrderStatus.PAID,
            refundAmount: currentRefunded, // optimistic lock
          },
          data: {
            refundAmount: newRefundAmount,
            refundedAt: new Date(),
            refundedBy: app.appId,
            refundReason: dto.reason,
            status:
              newRefundAmount >= order.amount
                ? PaymentOrderStatus.REFUNDED
                : PaymentOrderStatus.PAID,
          },
        })
        if (updateResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.ORDER_STATUS_CHANGED))
        }

        // 回滚日限额：仅当支付发生在当天时，退款才释放当日已用额度，
        // 避免付款方/商户退款后仍占用日限额导致无法继续交易
        if (order.paidAt) {
          const paidDateStr = order.paidAt.toISOString().slice(0, 10)
          const todayStr = new Date().toISOString().slice(0, 10)
          if (paidDateStr === todayStr) {
            if (order.payerId) {
              await this.rollbackDailyLimit(tx, order.payerId, 'CASHIER', todayStr, refundAmount)
            }
            await this.rollbackDailyLimit(tx, order.merchant.id, 'MERCHANT_PAYMENT', todayStr, refundAmount)
          }
        }

        return {
          orderNo: order.orderNo,
          status:
            newRefundAmount >= order.amount
              ? PaymentOrderStatus.REFUNDED
              : PaymentOrderStatus.PAID,
          refundAmountYuan: fenToYuan(refundAmount),
          totalRefundAmountYuan: fenToYuan(newRefundAmount),
          refundableYuan: fenToYuan(order.amount - newRefundAmount),
          transactionNo: txOrder.orderNo,
        }
      })
    })
  }

  // 转账：商户 -> 用户
  async transfer(
    app: MerchantApp,
    dto: {
      toUserId: string
      amount: number
      remark?: string
      idempotencyKey?: string
    },
  ) {
    const lockKey = `openapi:transfer:${app.appId}:${dto.idempotencyKey || dto.toUserId}`
    return this.redis.withLock(lockKey, REDIS_LOCK_TTL_SECONDS, async () => {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: app.merchantId },
      })
      if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

      if (dto.amount <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_AMOUNT_INVALID))
      }
      if (merchant.userId === dto.toUserId) {
        throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_TO_SELF))
      }

      const toUser = await this.prisma.user.findUnique({
        where: { id: dto.toUserId },
      })
      if (!toUser) throw new NotFoundException(kbError(KBErrorCodes.PAYEE_NOT_FOUND))
      if (toUser.realNameStatus !== RealNameStatus.VERIFIED) {
        throw new ForbiddenException(kbError(KBErrorCodes.PAYEE_NOT_VERIFIED))
      }
      if (
        toUser.status === UserStatus.FROZEN ||
        toUser.status === UserStatus.INCOME_RESTRICTED
      ) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '对方账户当前禁止收款'))
      }

      const fromUser = await this.prisma.user.findUnique({
        where: { id: merchant.userId },
      })
      if (!fromUser) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_USER_NOT_FOUND))
      if (
        fromUser.status === UserStatus.FROZEN ||
        fromUser.status === UserStatus.EXPENSE_RESTRICTED
      ) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '商户账户当前禁止支出'))
      }

      const amount = yuanToFen(dto.amount)

      // 风控检查：商户支出风控
      const riskResult = await this.riskEngine.check({
        userId: merchant.userId,
        type: 'TRANSFER',
        amount,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `转账被风控拦截：${riskResult.rules
              .filter((r) => r.action === 'BLOCK')
              .map((r) => r.name)
              .join('、')}`,
          ),
        )
      }

      return this.prisma.$transaction(async (tx) => {
        // 幂等
        if (dto.idempotencyKey) {
          const existing = await tx.transactionOrder.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          })
          if (existing) return existing
        }

        const fromAccount = await tx.account.findUnique({
          where: { userId: merchant.userId },
        })
        const toAccount = await tx.account.findUnique({
          where: { userId: dto.toUserId },
        })
        if (!fromAccount || !toAccount) {
          throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
        }
        if (fromAccount.status !== AccountStatus.ACTIVE) {
          throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '商户账户状态异常'))
        }
        if (toAccount.status !== AccountStatus.ACTIVE) {
          throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '收款方账户状态异常'))
        }

        const deductResult = await tx.account.updateMany({
          where: {
            id: fromAccount.id,
            availableBalance: { gte: amount },
          },
          data: {
            availableBalance: { decrement: amount },
            totalBalance: { decrement: amount },
          },
        })
        if (deductResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
        }

        // H4: updateMany 不返回更新后的记录，重新读取真实余额以保证账本 balanceBefore/After 准确
        const updatedFromAccount = await tx.account.findUnique({
          where: { id: fromAccount.id },
        })

        // 幂等键唯一约束冲突时必须抛错让事务回滚，避免重复扣款被提交：
        // 此前在 catch 中 return existing 会导致事务正常提交，但此时 fromAccount 已被扣减、
        // toAccount 未加钱、账单/分录未创建，净效果为商户余额被扣 2x 而收款方只到账 1x。
        // 幂等返回由事务开头的幂等检查处理（客户端重试时命中已存在订单）。
        const order = await tx.transactionOrder.create({
          data: {
            orderNo: generateOrderNo('T'),
            type: TransactionType.TRANSFER,
            status: TransactionStatus.SUCCESS,
            amount,
            fromUserId: merchant.userId,
            toUserId: dto.toUserId,
            remark: dto.remark || '商户转账',
            idempotencyKey: dto.idempotencyKey,
            completedAt: new Date(),
          },
        })

        const updatedTo = await tx.account.update({
          where: { id: toAccount.id },
          data: {
            availableBalance: { increment: amount },
            totalBalance: { increment: amount },
          },
        })

        await tx.accountLedger.create({
          data: {
            accountId: fromAccount.id,
            transactionId: order.id,
            type: LedgerType.TRANSFER,
            amount,
            // H4: 由重读的真实余额反推，避免陈旧读取
            balanceBefore: updatedFromAccount!.availableBalance + amount,
            balanceAfter: updatedFromAccount!.availableBalance,
            direction: Direction.CREDIT,
            remark: `转账给 ${toUser.nickname}`,
          },
        })

        await tx.accountLedger.create({
          data: {
            accountId: toAccount.id,
            transactionId: order.id,
            type: LedgerType.TRANSFER,
            amount,
            // H4: 由更新后真实余额反推
            balanceBefore: updatedTo.availableBalance - amount,
            balanceAfter: updatedTo.availableBalance,
            direction: Direction.DEBIT,
            remark: `来自 ${fromUser?.nickname || '商户'} 的转账`,
          },
        })

        await tx.bill.create({
          data: {
            userId: merchant.userId,
            transactionId: order.id,
            type: BillType.TRANSFER,
            direction: BillDirection.EXPENSE,
            amount,
            counterparty: toUser.nickname,
            remark: dto.remark || '商户转账',
          },
        })

        await tx.bill.create({
          data: {
            userId: dto.toUserId,
            transactionId: order.id,
            type: BillType.RECEIPT,
            direction: BillDirection.INCOME,
            amount,
            counterparty: fromUser?.nickname || merchant.merchantName,
            remark: dto.remark || '商户转账',
          },
        })

        return order
      })
    })
  }

  // 余额查询
  async balance(app: MerchantApp) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: app.merchantId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const account = await this.prisma.account.findUnique({
      where: { userId: merchant.userId },
    })
    if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

    return {
      availableYuan: fenToYuan(account.availableBalance),
      frozenYuan: fenToYuan(account.frozenBalance),
      totalYuan: fenToYuan(account.totalBalance),
    }
  }

  private formatOrderResponse(order: {
    orderNo: string
    amount: number
    status: PaymentOrderStatus
    expiredAt: Date | null
  }) {
    return {
      orderNo: order.orderNo,
      cashierUrl: `${this.getCashierBaseUrl()}/#cashier?orderNo=${order.orderNo}`,
      amountYuan: fenToYuan(order.amount),
      status: order.status,
      expiredAt: order.expiredAt,
    }
  }

  private async validateCallbackUrl(url: string) {
    const result = await isCallbackUrlSafe(url)
    if (!result.safe) {
      const code = result.reason === 'CALLBACK_URL_PROTOCOL_INVALID'
        ? KBErrorCodes.CALLBACK_URL_PROTOCOL_INVALID
        : result.reason === 'CALLBACK_URL_INTERNAL'
          ? KBErrorCodes.CALLBACK_URL_INTERNAL
          : KBErrorCodes.INVALID_PARAMETER
      throw new BadRequestException(kbError(code))
    }
  }

  // 回滚日限额：退款时释放当日已用额度，避免付款方/商户退款后仍占用日限额
  // 使用 version 乐观锁，并防止 usedAmount 变为负数
  // 回滚失败不抛错：退款主流程已成功，不应因限额回滚失败而回滚整个退款事务
  private async rollbackDailyLimit(
    tx: Prisma.TransactionClient,
    userId: string,
    limitType: string,
    date: string,
    amount: number,
  ): Promise<void> {
    let usage = await tx.dailyLimitUsage.findFirst({
      where: {
        userId,
        limitType,
        date,
      },
    })
    if (!usage) {
      usage = await tx.dailyLimitUsage.create({
        data: {
          userId,
          limitType,
          date,
          usedAmount: 0,
          version: 0,
        },
      })
    }

    await tx.dailyLimitUsage.updateMany({
      where: {
        id: usage.id,
        version: usage.version,
        usedAmount: { gte: amount },
      },
      data: {
        usedAmount: { decrement: amount },
        version: { increment: 1 },
      },
    })
  }
}
