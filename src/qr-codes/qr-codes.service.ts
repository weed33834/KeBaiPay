import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { Prisma } from '@prisma/client'
import {
  QrCodeType,
  QrCodeStatus,
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  RiskLevel,
  UserStatus,
  AccountStatus,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { fenToYuan, generateOrderNo, generateQrCode, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  DEFAULT_PAYMENT_DAILY_LIMIT_CENTS,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'

@Injectable()
export class QrCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
  ) {}

  async getPersonalCode(userId: string) {
    const code = await this.prisma.qrCode.findFirst({
      where: { userId, type: QrCodeType.PERSONAL, status: QrCodeStatus.ACTIVE },
    })
    if (code) return code

    // 并发场景下可能创建多条，通过 catch P2002 后重新查询避免
    try {
      return await this.prisma.qrCode.create({
        data: {
          code: generateQrCode(),
          userId,
          type: QrCodeType.PERSONAL,
          status: QrCodeStatus.ACTIVE,
        },
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // 并发创建导致 code 唯一冲突，重新查询即可
        const existing = await this.prisma.qrCode.findFirst({
          where: { userId, type: QrCodeType.PERSONAL, status: QrCodeStatus.ACTIVE },
        })
        if (existing) return existing
      }
      throw e
    }
  }

  async createFixedCode(
    userId: string,
    dto: { amount: number; remark?: string },
  ) {
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER))
    }
    const amount = yuanToFen(dto.amount)
    return this.prisma.qrCode.create({
      data: {
        code: generateQrCode(),
        userId,
        type: QrCodeType.FIXED_AMOUNT,
        amount,
        remark: dto.remark,
        status: QrCodeStatus.ACTIVE,
      },
    })
  }

  async pay(
    payerId: string,
    dto: { code: string; amount?: number; remark?: string; payPassword: string; idempotencyKey?: string },
  ) {
    const payer = await this.usersService.findById(payerId)
    if (!payer) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND, '付款用户不存在'))
    if (payer.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (payer.status === UserStatus.FROZEN || payer.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户当前禁止支出'))
    }
    if (payer.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户风险等级过高，禁止付款'))
    }
    await this.usersService.verifyPayPassword(payerId, dto.payPassword)

    const qrCode = await this.prisma.qrCode.findUnique({
      where: { code: dto.code },
      include: { user: true },
    })
    if (!qrCode || qrCode.status !== QrCodeStatus.ACTIVE) {
      throw new NotFoundException(kbError(KBErrorCodes.QR_CODE_INVALID))
    }
    if (qrCode.type === QrCodeType.MERCHANT) {
      throw new BadRequestException(kbError(KBErrorCodes.QR_CODE_USE_CASHIER))
    }
    if (qrCode.userId === payerId) {
      throw new BadRequestException(kbError(KBErrorCodes.QR_CODE_PAY_SELF))
    }
    if (qrCode.user.status === UserStatus.FROZEN || qrCode.user.status === UserStatus.INCOME_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '对方账户当前禁止收款'))
    }

    const amount = qrCode.type === QrCodeType.FIXED_AMOUNT
      ? qrCode.amount!
      : yuanToFen(dto.amount || 0)

    if (!amount || amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER))
    }

    // 风控检查：在事务前执行，拦截高风险交易
    const riskResult = await this.riskEngine.check({
      userId: payerId,
      type: 'PAYMENT',
      amount: amount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `支付被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
        ),
      )
    }

    const dateStr = new Date().toISOString().slice(0, 10)

    const runTransaction = async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 幂等：命中已有订单则直接返回，不重复扣款
          if (dto.idempotencyKey) {
            const existing = await tx.transactionOrder.findUnique({
              where: { idempotencyKey: dto.idempotencyKey },
            })
            if (existing) {
              // H5: 校验归属，防止不同付款方使用相同 idempotencyKey 获取他人订单
              if (existing.fromUserId !== payerId) {
                throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
              }
              return existing
            }
          }

          const config = await tx.systemConfig.findUnique({
            where: { key: 'payment_daily_limit' },
          })
          const limit = config ? Math.round(Number(config.value) * 100) : DEFAULT_PAYMENT_DAILY_LIMIT_CENTS

          // 单日限额校验放入事务内，保证原子性
          await this.usersService.checkAndIncrementDailyLimit(
            tx,
            payerId,
            'PAYMENT',
            dateStr,
            amount,
            limit,
          )

          const payerAccount = await tx.account.findUnique({
            where: { userId: payerId },
          })
          const receiverAccount = await tx.account.findUnique({
            where: { userId: qrCode.userId },
          })
          if (!payerAccount || !receiverAccount) {
            throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
          }
          if (payerAccount.status !== AccountStatus.ACTIVE) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '付款账户状态异常'))
          }
          if (receiverAccount.status !== AccountStatus.ACTIVE) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '收款账户状态异常'))
          }

          const orderNo = generateOrderNo('Q')
          const order = await tx.transactionOrder.create({
            data: {
              orderNo,
              type: TransactionType.PAYMENT,
              status: TransactionStatus.SUCCESS,
              amount,
              fromUserId: payerId,
              toUserId: qrCode.userId,
              remark: dto.remark || qrCode.remark || '扫码付款',
              idempotencyKey: dto.idempotencyKey,
              completedAt: new Date(),
            },
          })

          // 付款方原子扣款，防止并发透支
          const debitResult = await tx.account.updateMany({
            where: {
              id: payerAccount.id,
              availableBalance: { gte: amount },
            },
            data: {
              availableBalance: { decrement: amount },
              totalBalance: { decrement: amount },
            },
          })
          if (debitResult.count === 0) {
            throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
          }

          const updatedReceiver = await tx.account.update({
            where: { id: receiverAccount.id },
            data: {
              availableBalance: { increment: amount },
              totalBalance: { increment: amount },
            },
          })

          const updatedPayer = await tx.account.findUnique({
            where: { id: payerAccount.id },
          })

          await tx.accountLedger.create({
            data: {
              accountId: payerAccount.id,
              transactionId: order.id,
              type: LedgerType.PAYMENT,
              amount,
              // H1: balanceAfter 取重新读取的真实余额，balanceBefore = balanceAfter + amount（扣款前）
              balanceBefore: updatedPayer!.availableBalance + amount,
              balanceAfter: updatedPayer!.availableBalance,
              direction: Direction.CREDIT,
              remark: `扫码付款给 ${qrCode.user.nickname}`,
            },
          })

          await tx.accountLedger.create({
            data: {
              accountId: receiverAccount.id,
              transactionId: order.id,
              type: LedgerType.PAYMENT,
              amount,
              // H1: balanceAfter 取 update 返回的真实余额，balanceBefore = balanceAfter - amount（加款前）
              balanceBefore: updatedReceiver.availableBalance - amount,
              balanceAfter: updatedReceiver.availableBalance,
              direction: Direction.DEBIT,
              remark: `来自 ${payer.nickname} 的扫码付款`,
            },
          })

          await tx.bill.create({
            data: {
              userId: payerId,
              transactionId: order.id,
              type: BillType.PAYMENT,
              direction: BillDirection.EXPENSE,
              amount,
              counterparty: qrCode.user.nickname,
              remark: dto.remark || '扫码付款',
            },
          })
          await tx.bill.create({
            data: {
              userId: qrCode.userId,
              transactionId: order.id,
              type: BillType.RECEIPT,
              direction: BillDirection.INCOME,
              amount,
              counterparty: payer.nickname,
              remark: dto.remark || '扫码收款',
            },
          })

          return order
        })
      } catch (e) {
        // 并发场景下 idempotencyKey 唯一约束冲突：查回原单幂等返回，避免返回 500
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          dto.idempotencyKey
        ) {
          const existing = await this.prisma.transactionOrder.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          })
          if (existing) return existing
        }
        throw e
      }
    }

    // 同 idempotencyKey 并发请求通过 Redis 锁串行化，防止第二个 create 抛 P2002 未捕获
    if (dto.idempotencyKey) {
      return this.redis.withLock(
        `qrpay:idem:${dto.idempotencyKey}`,
        REDIS_LOCK_TTL_SECONDS,
        runTransaction,
      )
    }
    return runTransaction()
  }

}
