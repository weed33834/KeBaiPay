import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  RiskLevel,
  RiskEventType,
  AccountStatus,
  UserStatus,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { DEFAULT_TRANSFER_DAILY_LIMIT_CENTS, LARGE_TRANSFER_THRESHOLD_CENTS, REDIS_LOCK_TTL_SECONDS } from '../common/constants'

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  async transfer(
    fromUserId: string,
    dto: { toUserId: string; amount: number; remark?: string; payPassword: string; idempotencyKey?: string },
  ) {
    const lockKey = dto.idempotencyKey
      ? `transfer:idem:${dto.idempotencyKey}`
      : `transfer:user:${fromUserId}`
    return this.redis.withLock(lockKey, REDIS_LOCK_TTL_SECONDS, async () => {
      if (dto.amount <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_AMOUNT_INVALID))
      }
      if (fromUserId === dto.toUserId) {
        throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_TO_SELF))
      }

      // 实名与支付密码校验
      const fromUser = await this.usersService.findById(fromUserId)
      if (!fromUser) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
      if (fromUser.realNameStatus !== RealNameStatus.VERIFIED) {
        throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
      }
      if (fromUser.status === UserStatus.FROZEN || fromUser.status === UserStatus.EXPENSE_RESTRICTED) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户当前禁止支出'))
      }
      if (fromUser.riskLevel === RiskLevel.HIGH) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户风险等级过高，禁止转账'))
      }
      await this.usersService.verifyPayPassword(fromUserId, dto.payPassword)

      const toUser = await this.usersService.findById(dto.toUserId)
      if (!toUser) throw new NotFoundException(kbError(KBErrorCodes.PAYEE_NOT_FOUND))
      if (toUser.realNameStatus !== RealNameStatus.VERIFIED) {
        throw new ForbiddenException(kbError(KBErrorCodes.PAYEE_NOT_VERIFIED))
      }
      if (toUser.status === UserStatus.FROZEN || toUser.status === UserStatus.INCOME_RESTRICTED) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '对方账户当前禁止收款'))
      }

      const amount = yuanToFen(dto.amount)

      // 风控检查：在事务前执行，拦截则直接抛错
      const riskResult = await this.riskEngine.check({
        userId: fromUserId,
        type: 'TRANSFER',
        amount,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `交易被风控拦截：${riskResult.rules
              .filter((r) => r.action === 'BLOCK')
              .map((r) => r.name)
              .join('、')}`,
          ),
        )
      }

      const dateStr = new Date().toISOString().slice(0, 10)

      return this.prisma.$transaction(async (tx) => {
        // 幂等：命中已有订单则直接返回，不重复到账
        if (dto.idempotencyKey) {
          const existing = await tx.transactionOrder.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          })
          if (existing) {
            // 校验归属：防止不同用户使用相同 idempotencyKey 获取他人订单
            if (existing.fromUserId !== fromUserId) {
              throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
            }
            return existing
          }
        }

        const config = await tx.systemConfig.findUnique({
          where: { key: 'transfer_daily_limit' },
        })
        const limit = config ? Math.round(Number(config.value) * 100) : DEFAULT_TRANSFER_DAILY_LIMIT_CENTS

        // 单日限额校验放入事务内，保证原子性，避免高并发突破限额
        await this.usersService.checkAndIncrementDailyLimit(
          tx,
          fromUserId,
          'TRANSFER',
          dateStr,
          amount,
          limit,
        )

        const fromAccount = await tx.account.findUnique({
          where: { userId: fromUserId },
        })
        const toAccount = await tx.account.findUnique({
          where: { userId: dto.toUserId },
        })
        if (!fromAccount || !toAccount) {
          throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
        }
        if (fromAccount.status !== AccountStatus.ACTIVE) {
          throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '付款方账户状态异常'))
        }
        if (toAccount.status !== AccountStatus.ACTIVE) {
          throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '收款方账户状态异常'))
        }

        const orderNo = generateOrderNo('T')

        // 原子扣款：通过 updateMany + 余额条件避免并发透支
        const senderUpdate = await tx.account.updateMany({
          where: {
            id: fromAccount.id,
            availableBalance: { gte: amount },
          },
          data: {
            availableBalance: { decrement: amount },
            totalBalance: { decrement: amount },
          },
        })
        if (senderUpdate.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
        }

        // H1: updateMany 不返回更新后的记录，重新读取真实余额，保证账本 balanceBefore/After 准确
        const updatedFromAccount = await tx.account.findUnique({
          where: { id: fromAccount.id },
        })
        if (!updatedFromAccount) {
          throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
        }
        const senderBalanceAfter = updatedFromAccount.availableBalance
        // 扣款后余额 = 扣款前余额 - amount，故 balanceBefore = balanceAfter + amount
        const senderBalanceBefore = senderBalanceAfter + amount

        const updatedTo = await tx.account.update({
          where: { id: toAccount.id },
          data: {
            availableBalance: { increment: amount },
            totalBalance: { increment: amount },
          },
        })
        // H1: 加款方 balanceAfter 取 update 返回的真实值，balanceBefore = balanceAfter - amount
        const receiverBalanceAfter = updatedTo.availableBalance
        const receiverBalanceBefore = receiverBalanceAfter - amount

        // 幂等键唯一约束冲突时必须抛错让事务回滚，避免重复扣款被提交
        // 幂等返回在外层（事务外）处理
        const order = await tx.transactionOrder.create({
          data: {
            orderNo,
            type: TransactionType.TRANSFER,
            status: TransactionStatus.SUCCESS,
            amount,
            fromUserId,
            toUserId: dto.toUserId,
            remark: dto.remark || '转账',
            idempotencyKey: dto.idempotencyKey,
            completedAt: new Date(),
          },
        })

        await tx.accountLedger.create({
          data: {
            accountId: fromAccount.id,
            transactionId: order.id,
            type: LedgerType.TRANSFER,
            amount,
            balanceBefore: senderBalanceBefore,
            balanceAfter: senderBalanceAfter,
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
            balanceBefore: receiverBalanceBefore,
            balanceAfter: receiverBalanceAfter,
            direction: Direction.DEBIT,
            remark: `来自 ${fromUser.nickname} 的转账`,
          },
        })

        await tx.bill.create({
          data: {
            userId: fromUserId,
            transactionId: order.id,
            type: BillType.TRANSFER,
            direction: BillDirection.EXPENSE,
            amount,
            counterparty: toUser.nickname,
            remark: dto.remark || '转账',
          },
        })
        await tx.bill.create({
          data: {
            userId: dto.toUserId,
            transactionId: order.id,
            type: BillType.RECEIPT,
            direction: BillDirection.INCOME,
            amount,
            counterparty: fromUser.nickname,
            remark: dto.remark || '转账',
          },
        })

        if (amount > LARGE_TRANSFER_THRESHOLD_CENTS) {
          await tx.riskEvent.create({
            data: {
              userId: fromUserId,
              type: RiskEventType.LARGE_TRANSFER,
              level: RiskLevel.MEDIUM,
              description: `大额转账 ${fenToYuan(amount)} 元`,
            },
          })
        }

        return order
      })
    })
  }

}
