import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  SplitStatus,
  SplitItemStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  UserStatus,
  RiskLevel,
  RiskEventType,
  AccountStatus,
  TransactionType,
  TransactionStatus,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  DEFAULT_SPLIT_DAILY_LIMIT_CENTS,
  LARGE_SPLIT_THRESHOLD_CENTS,
  MAX_SPLIT_RECEIVERS,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'
import { CreateSplitDto } from './dto/create-split.dto'

/**
 * 分账 Split 服务
 *
 * 资金流：
 *  1. createSplit：
 *     - 校验 sender / 源订单（TransactionOrder 必须 SUCCESS 且 fromUserId = sender）
 *     - 校验接收方列表（非空、去重、不含 sender 自己）
 *     - 校验分账总额 ≤ 源订单可分账金额
 *     - 风控、单日限额
 *     - 事务：落 SplitOrder(PENDING) + SplitItem(PENDING) → 标记 PENDING → PROCESSING
 *  2. 逐笔处理（每笔独立事务）：
 *     - 校验收款人存在、实名、账户状态
 *     - 成功：sender.availableBalance → receiver.availableBalance，写账本/账单/订单，标记 SUCCESS
 *     - 失败：标记 FAILED，资金不流动
 *  3. 收尾：
 *     - 标记 PROCESSING → COMPLETED（即使部分失败也整体 COMPLETED）
 *  4. cancel：仅 PENDING 状态可取消（通常 PENDING 立即转入 PROCESSING）
 */
@Injectable()
export class SplitsService {
  private readonly logger = new Logger(SplitsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  /** 提交分账订单 */
  async createSplit(senderId: string, dto: CreateSplitDto) {
    // 基础校验
    if (!dto.receivers || dto.receivers.length === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.SPLIT_RECEIVER_EMPTY))
    }
    if (dto.receivers.length > MAX_SPLIT_RECEIVERS) {
      throw new BadRequestException(
        kbError(KBErrorCodes.BATCH_TRANSFER_TOO_MANY, '分账接收方数量超限'),
      )
    }
    // 接收方去重
    const receiverIds = dto.receivers.map((r) => r.receiverId)
    const uniqueIds = new Set(receiverIds)
    if (uniqueIds.size !== receiverIds.length) {
      throw new BadRequestException(kbError(KBErrorCodes.SPLIT_RECEIVER_DUPLICATED))
    }
    // 不能给自己分账
    if (receiverIds.includes(senderId)) {
      throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_TO_SELF))
    }
    // 金额校验
    for (const r of dto.receivers) {
      if (r.amount <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.SPLIT_AMOUNT_INVALID))
      }
    }

    // sender 校验
    const sender = await this.usersService.findById(senderId)
    if (!sender) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (sender.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (sender.status === UserStatus.FROZEN || sender.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户状态异常，无法发起分账'))
    }
    if (sender.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '高风险用户无法发起分账'))
    }

    // 源订单校验：必须是 SUCCESS 状态的 TransactionOrder，且 fromUserId = sender
    // sourceOrderNo 可以是 orderNo 或 UUID（id）
    const sourceOrder = await this.prisma.transactionOrder.findFirst({
      where: {
        OR: [
          { orderNo: dto.sourceOrderNo },
          { id: dto.sourceOrderNo },
        ],
      },
    })
    if (!sourceOrder) {
      throw new NotFoundException(kbError(KBErrorCodes.SPLIT_SOURCE_ORDER_NOT_FOUND))
    }
    if (sourceOrder.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException(kbError(KBErrorCodes.SPLIT_SOURCE_ORDER_NOT_FOUND))
    }
    if (sourceOrder.fromUserId !== senderId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权对该源订单发起分账'))
    }

    // 计算分账总金额
    const totalAmount = dto.receivers.reduce(
      (sum, r) => sum + yuanToFen(r.amount),
      0,
    )
    // 校验分账总额不超过源订单金额
    if (totalAmount > sourceOrder.amount) {
      throw new BadRequestException(kbError(KBErrorCodes.SPLIT_AMOUNT_EXCEED_SOURCE))
    }

    // 风控
    const riskResult = await this.riskEngine.check({
      userId: senderId,
      type: 'TRANSFER',
      amount: totalAmount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `分账被风控拦截：${riskResult.rules
            .filter((r) => r.action === 'BLOCK')
            .map((r) => r.name)
            .join('、')}`,
        ),
      )
    }

    const lockKey = dto.idempotencyKey
      ? `split:idem:${dto.idempotencyKey}`
      : `split:user:${senderId}:${dto.sourceOrderNo}`

    return this.redis.withLock(lockKey, REDIS_LOCK_TTL_SECONDS, async () => {
      // 1. 落分账记录（事务）
      const split = await this.prisma.$transaction(async (tx) => {
        // 幂等
        if (dto.idempotencyKey) {
          const existing = await tx.splitOrder.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { items: true },
          })
          if (existing) {
            if (existing.senderId !== senderId) {
              throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
            }
            return existing
          }
        }

        // 单日限额
        const dateStr = new Date().toISOString().slice(0, 10)
        const limitConfig = await tx.systemConfig.findUnique({
          where: { key: 'split_daily_limit' },
        })
        const limit = limitConfig
          ? Math.round(Number(limitConfig.value) * 100)
          : DEFAULT_SPLIT_DAILY_LIMIT_CENTS
        await this.usersService.checkAndIncrementDailyLimit(
          tx,
          senderId,
          'SPLIT',
          dateStr,
          totalAmount,
          limit,
        )

        // 账户校验
        const senderAccount = await tx.account.findUnique({
          where: { userId: senderId },
        })
        if (!senderAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
        if (senderAccount.status !== AccountStatus.ACTIVE) {
          throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '付款方账户状态异常'))
        }
        if (senderAccount.availableBalance < totalAmount) {
          throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
        }

        // 生成分账单号
        const splitNo = generateOrderNo('SPL')

        // 创建分账订单 + 明细
        const created = await tx.splitOrder.create({
          data: {
            splitNo,
            senderId,
            sourceOrderNo: dto.sourceOrderNo,
            sourceAmount: sourceOrder.amount,
            splitAmount: totalAmount,
            receiverCount: dto.receivers.length,
            remark: dto.remark,
            idempotencyKey: dto.idempotencyKey,
            status: SplitStatus.PENDING,
            items: {
              create: dto.receivers.map((r) => ({
                receiverId: r.receiverId,
                amount: yuanToFen(r.amount),
                status: SplitItemStatus.PENDING,
              })),
            },
          },
          include: { items: true },
        })

        // 标记 PENDING → PROCESSING
        const lockResult = await tx.splitOrder.updateMany({
          where: { id: created.id, status: SplitStatus.PENDING },
          data: { status: SplitStatus.PROCESSING },
        })
        if (lockResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.SPLIT_STATUS_INVALID))
        }

        return tx.splitOrder.findUnique({
          where: { id: created.id },
          include: { items: true },
        })
      })

      // 2. 逐笔处理（独立事务，不抛异常）
      if (split) {
        for (const item of split.items) {
          await this.processSplitItem(item.id, senderId, split.splitNo)
        }
        // 3. 收尾
        await this.finalizeSplit(split.id)
      }
      return split
    })
  }

  /**
   * 处理单笔分账明细（独立事务）
   * 不抛异常，通过返回值告知结果
   */
  private async processSplitItem(
    itemId: string,
    senderId: string,
    splitNo: string,
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.splitItem.findUnique({
          where: { id: itemId },
        })
        if (!item) {
          return { success: false, reason: '分账明细不存在' }
        }
        if (item.status !== SplitItemStatus.PENDING) {
          return { success: true }
        }

        // 校验收款人
        const receiver = await tx.user.findUnique({
          where: { id: item.receiverId },
        })
        if (!receiver) {
          await tx.splitItem.update({
            where: { id: item.id },
            data: {
              status: SplitItemStatus.FAILED,
              failureReason: '收款方不存在',
            },
          })
          return { success: false, reason: '收款方不存在' }
        }
        if (receiver.realNameStatus !== RealNameStatus.VERIFIED) {
          await tx.splitItem.update({
            where: { id: item.id },
            data: {
              status: SplitItemStatus.FAILED,
              failureReason: '收款方未实名',
            },
          })
          return { success: false, reason: '收款方未实名' }
        }
        if (receiver.status === UserStatus.FROZEN || receiver.status === UserStatus.INCOME_RESTRICTED) {
          await tx.splitItem.update({
            where: { id: item.id },
            data: {
              status: SplitItemStatus.FAILED,
              failureReason: '收款方账户禁止收款',
            },
          })
          return { success: false, reason: '收款方账户禁止收款' }
        }

        // 校验账户
        const senderAccount = await tx.account.findUnique({
          where: { userId: senderId },
        })
        if (!senderAccount || senderAccount.status !== AccountStatus.ACTIVE) {
          await tx.splitItem.update({
            where: { id: item.id },
            data: {
              status: SplitItemStatus.FAILED,
              failureReason: '付款方账户状态异常',
            },
          })
          return { success: false, reason: '付款方账户状态异常' }
        }
        const receiverAccount = await tx.account.findUnique({
          where: { userId: item.receiverId },
        })
        if (!receiverAccount || receiverAccount.status !== AccountStatus.ACTIVE) {
          await tx.splitItem.update({
            where: { id: item.id },
            data: {
              status: SplitItemStatus.FAILED,
              failureReason: '收款方账户状态异常',
            },
          })
          return { success: false, reason: '收款方账户状态异常' }
        }

        // 转账：sender.availableBalance → receiver.availableBalance
        const deductResult = await tx.account.updateMany({
          where: {
            id: senderAccount.id,
            availableBalance: { gte: item.amount },
          },
          data: {
            availableBalance: { decrement: item.amount },
            totalBalance: { decrement: item.amount },
          },
        })
        if (deductResult.count === 0) {
          await tx.splitItem.update({
            where: { id: item.id },
            data: {
              status: SplitItemStatus.FAILED,
              failureReason: '余额不足',
            },
          })
          return { success: false, reason: '余额不足' }
        }

        const updatedSender = await tx.account.findUnique({
          where: { id: senderAccount.id },
        })
        const updatedReceiver = await tx.account.update({
          where: { id: receiverAccount.id },
          data: {
            availableBalance: { increment: item.amount },
            totalBalance: { increment: item.amount },
          },
        })

        // 创建交易订单
        const orderNo = generateOrderNo('T')
        const order = await tx.transactionOrder.create({
          data: {
            orderNo,
            type: TransactionType.TRANSFER,
            status: TransactionStatus.SUCCESS,
            amount: item.amount,
            fromUserId: senderId,
            toUserId: item.receiverId,
            remark: `分账 ${splitNo}`,
            relatedOrderNo: splitNo,
            completedAt: new Date(),
          },
        })

        // 账本
        await tx.accountLedger.create({
          data: {
            accountId: senderAccount.id,
            transactionId: order.id,
            type: LedgerType.BATCH_TRANSFER, // 复用批量转账类型
            amount: item.amount,
            balanceBefore: updatedSender!.availableBalance + item.amount,
            balanceAfter: updatedSender!.availableBalance,
            direction: Direction.CREDIT,
            remark: `分账 ${splitNo}`,
          },
        })
        await tx.accountLedger.create({
          data: {
            accountId: receiverAccount.id,
            transactionId: order.id,
            type: LedgerType.BATCH_TRANSFER,
            amount: item.amount,
            balanceBefore: updatedReceiver.availableBalance - item.amount,
            balanceAfter: updatedReceiver.availableBalance,
            direction: Direction.DEBIT,
            remark: `分账收款 ${splitNo}`,
          },
        })

        // 账单
        const senderUser = await tx.user.findUnique({
          where: { id: senderId },
          select: { nickname: true },
        })
        const receiverUser = await tx.user.findUnique({
          where: { id: item.receiverId },
          select: { nickname: true },
        })
        await tx.bill.create({
          data: {
            userId: senderId,
            transactionId: order.id,
            type: BillType.TRANSFER,
            direction: BillDirection.EXPENSE,
            amount: item.amount,
            counterparty: receiverUser?.nickname || '',
            remark: `分账 ${splitNo}`,
          },
        })
        await tx.bill.create({
          data: {
            userId: item.receiverId,
            transactionId: order.id,
            type: BillType.RECEIPT,
            direction: BillDirection.INCOME,
            amount: item.amount,
            counterparty: senderUser?.nickname || '',
            remark: `分账收款 ${splitNo}`,
          },
        })

        // 大额告警
        if (item.amount > LARGE_SPLIT_THRESHOLD_CENTS) {
          await tx.riskEvent.create({
            data: {
              userId: senderId,
              type: RiskEventType.LARGE_TRANSFER,
              level: RiskLevel.MEDIUM,
              description: `大额分账 ${fenToYuan(item.amount)} 元`,
            },
          })
        }

        // 标记成功
        await tx.splitItem.update({
          where: { id: item.id },
          data: {
            status: SplitItemStatus.SUCCESS,
            transactionId: order.id,
            completedAt: new Date(),
          },
        })

        return { success: true }
      })
    } catch (err) {
      this.logger.error(`分账明细 ${itemId} 处理异常: ${err}`)
      try {
        await this.prisma.splitItem.update({
          where: { id: itemId },
          data: {
            status: SplitItemStatus.FAILED,
            failureReason: err instanceof Error ? err.message : String(err),
          },
        })
      } catch (updateErr) {
        this.logger.error(`分账明细 ${itemId} 标记失败状态时异常: ${updateErr}`)
      }
      return { success: false, reason: '处理异常' }
    }
  }

  /** 分账收尾：统计成功/失败笔数，标记 COMPLETED */
  private async finalizeSplit(splitId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [successCount, failedCount] = await Promise.all([
        tx.splitItem.count({
          where: { splitId, status: SplitItemStatus.SUCCESS },
        }),
        tx.splitItem.count({
          where: { splitId, status: SplitItemStatus.FAILED },
        }),
      ])

      // 查询当前状态（可能是 CANCELLED）
      const split = await tx.splitOrder.findUnique({ where: { id: splitId } })
      if (!split) return null

      if (split.status === SplitStatus.CANCELLED) {
        return split
      }

      return tx.splitOrder.update({
        where: { id: splitId },
        data: {
          successCount,
          failedCount,
          status: SplitStatus.COMPLETED,
          completedAt: new Date(),
        },
      })
    })
  }

  /** 查询分账订单详情 */
  async findBySplitNo(userId: string, splitNo: string) {
    const split = await this.prisma.splitOrder.findUnique({
      where: { splitNo },
      include: { items: true },
    })
    if (!split) throw new NotFoundException(kbError(KBErrorCodes.SPLIT_ORDER_NOT_FOUND))
    // sender 或任意 receiver 均可查看
    const canView = split.senderId === userId
      || split.items.some((i) => i.receiverId === userId)
    if (!canView) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该分账订单'))
    }
    return split
  }

  /** 列出当前用户的分账订单（作为 sender） */
  async list(senderId: string, query: { status?: string; page?: number; limit?: number }) {
    const where: Prisma.SplitOrderWhereInput = { senderId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.splitOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.splitOrder.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 取消分账订单（仅 PENDING 状态可取消） */
  async cancel(senderId: string, splitNo: string) {
    return this.prisma.$transaction(async (tx) => {
      const split = await tx.splitOrder.findUnique({
        where: { splitNo },
      })
      if (!split) throw new NotFoundException(kbError(KBErrorCodes.SPLIT_ORDER_NOT_FOUND))
      if (split.senderId !== senderId) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该分账订单'))
      }
      if (split.status !== SplitStatus.PENDING) {
        throw new BadRequestException(kbError(KBErrorCodes.SPLIT_STATUS_INVALID))
      }
      const lockResult = await tx.splitOrder.updateMany({
        where: { id: split.id, status: SplitStatus.PENDING },
        data: {
          status: SplitStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.SPLIT_STATUS_INVALID))
      }
      return tx.splitOrder.findUnique({ where: { id: split.id } })
    })
  }
}
