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
  BatchTransferStatus,
  BatchItemStatus,
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
  DEFAULT_BATCH_TRANSFER_DAILY_LIMIT_CENTS,
  LARGE_BATCH_TRANSFER_THRESHOLD_CENTS,
  MAX_BATCH_TRANSFER_ITEMS,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'
import { CreateBatchTransferDto } from './dto/create-batch-transfer.dto'

/**
 * 批量转账/代发服务
 *
 * 资金流：
 *  1. createBatch:
 *     - 校验 sender 实名/状态/风控/单日限额
 *     - 校验明细数量、单笔金额、收款方不重复
 *     - 计算总金额（successTotal）
 *     - 落 BatchTransfer(PENDING) + BatchTransferItem(PENDING) 记录
 *     - 扣 sender.availableBalance → 入 sender.frozenBalance（保证总金额足够）
 *     - 标记 PENDING → PROCESSING
 *  2. 逐笔处理（每笔独立事务）：
 *     - 校验收款人是否存在、是否实名、账户状态
 *     - 成功：from sender.frozenBalance → to receiver.availableBalance，写账本/账单/订单，标记 SUCCESS
 *     - 失败：标记 FAILED + failureReason，资金不流动
 *  3. 全部完成后：
 *     - 失败笔数的总金额从 sender.frozenBalance 退回 sender.availableBalance
 *     - 标记 PROCESSING → COMPLETED
 *  4. cancel: 仅 PENDING 状态可取消（无资金流动），但通常 PENDING 立即转入 PROCESSING
 */
@Injectable()
export class BatchTransfersService {
  private readonly logger = new Logger(BatchTransfersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  /** 提交批量转账 */
  async createBatch(senderId: string, dto: CreateBatchTransferDto) {
    // 基础校验
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.BATCH_TRANSFER_EMPTY))
    }
    if (dto.items.length > MAX_BATCH_TRANSFER_ITEMS) {
      throw new BadRequestException(kbError(KBErrorCodes.BATCH_TRANSFER_TOO_MANY))
    }
    // 收款方去重检查
    const toUserIds = dto.items.map((i) => i.toUserId)
    const uniqueToUserIds = new Set(toUserIds)
    if (uniqueToUserIds.size !== toUserIds.length) {
      throw new BadRequestException(kbError(KBErrorCodes.BATCH_TRANSFER_ITEM_DUPLICATED))
    }
    // 不能给自己转账
    if (toUserIds.includes(senderId)) {
      throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_TO_SELF))
    }
    // 单笔金额校验（DTO 已限 0.01 ~ 5000，二次校验防御）
    for (const item of dto.items) {
      if (item.amount <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.BATCH_TRANSFER_ITEM_INVALID))
      }
    }

    // sender 校验
    const sender = await this.usersService.findById(senderId)
    if (!sender) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (sender.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (sender.status === UserStatus.FROZEN || sender.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户状态异常，无法发起批量转账'))
    }
    if (sender.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '高风险用户无法发起批量转账'))
    }

    // 计算总金额（分）
    const totalAmount = dto.items.reduce(
      (sum, item) => sum + yuanToFen(item.amount),
      0,
    )

    // 风控检查
    const riskResult = await this.riskEngine.check({
      userId: senderId,
      type: 'TRANSFER',
      amount: totalAmount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `批量转账被风控拦截：${riskResult.rules
            .filter((r) => r.action === 'BLOCK')
            .map((r) => r.name)
            .join('、')}`,
        ),
      )
    }

    const lockKey = dto.idempotencyKey
      ? `batch-transfer:idem:${dto.idempotencyKey}`
      : `batch-transfer:user:${senderId}`

    return this.redis.withLock(lockKey, REDIS_LOCK_TTL_SECONDS, async () => {
      // 1. 落批次记录 + 扣款冻结（事务）
      const batch = await this.prisma.$transaction(async (tx) => {
        // 幂等：命中已有批次则直接返回
        if (dto.idempotencyKey) {
          const existing = await tx.batchTransfer.findUnique({
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
          where: { key: 'batch_transfer_daily_limit' },
        })
        const limit = limitConfig
          ? Math.round(Number(limitConfig.value) * 100)
          : DEFAULT_BATCH_TRANSFER_DAILY_LIMIT_CENTS
        await this.usersService.checkAndIncrementDailyLimit(
          tx,
          senderId,
          'BATCH_TRANSFER',
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

        // 扣款冻结：sender.availableBalance → sender.frozenBalance（总金额）
        const deductResult = await tx.account.updateMany({
          where: {
            id: senderAccount.id,
            availableBalance: { gte: totalAmount },
          },
          data: {
            availableBalance: { decrement: totalAmount },
            frozenBalance: { increment: totalAmount },
          },
        })
        if (deductResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
        }

        // 生成批次号 + 落记录
        const batchNo = generateOrderNo('BT')
        const freezeOrderNo = generateOrderNo('T')

        // 批次冻结资金的虚拟订单（作为 AccountLedger.transactionId 的占位）
        const freezeOrder = await tx.transactionOrder.create({
          data: {
            orderNo: freezeOrderNo,
            type: TransactionType.TRANSFER,
            status: TransactionStatus.SUCCESS,
            amount: totalAmount,
            fromUserId: senderId,
            remark: `批量转账冻结 ${batchNo}`,
            completedAt: new Date(),
          },
        })

        const created = await tx.batchTransfer.create({
          data: {
            batchNo,
            senderId,
            totalCount: dto.items.length,
            successCount: 0,
            failedCount: 0,
            totalAmount,
            status: BatchTransferStatus.PENDING,
            remark: dto.remark,
            idempotencyKey: dto.idempotencyKey,
            items: {
              create: dto.items.map((item) => ({
                toUserId: item.toUserId,
                amount: yuanToFen(item.amount),
                status: BatchItemStatus.PENDING,
              })),
            },
          },
          include: { items: true },
        })

        // 账本：sender 余额扣减（冻结）
        const updatedAccount = await tx.account.findUnique({
          where: { id: senderAccount.id },
        })
        const balanceAfter = updatedAccount!.availableBalance
        const balanceBefore = balanceAfter + totalAmount
        await tx.accountLedger.create({
          data: {
            accountId: senderAccount.id,
            transactionId: freezeOrder.id,
            type: LedgerType.BATCH_TRANSFER,
            amount: totalAmount,
            balanceBefore,
            balanceAfter,
            direction: Direction.CREDIT,
            remark: `批量转账 ${batchNo} 冻结资金（${dto.items.length} 笔）`,
          },
        })

        // 标记 PENDING → PROCESSING
        const lockResult = await tx.batchTransfer.updateMany({
          where: { id: created.id, status: BatchTransferStatus.PENDING },
          data: { status: BatchTransferStatus.PROCESSING },
        })
        if (lockResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.BATCH_TRANSFER_NOT_CANCELLABLE))
        }

        // 大额告警
        if (totalAmount > LARGE_BATCH_TRANSFER_THRESHOLD_CENTS) {
          await tx.riskEvent.create({
            data: {
              userId: senderId,
              type: RiskEventType.LARGE_TRANSFER,
              level: RiskLevel.MEDIUM,
              description: `大额批量转账 ${fenToYuan(totalAmount)} 元（${dto.items.length} 笔）`,
            },
          })
        }

        return tx.batchTransfer.findUnique({
          where: { id: created.id },
          include: { items: true },
        })
      })

      // 2. 逐笔处理（每笔独立事务，避免一笔失败影响其他）
      let successCount = 0
      let failedCount = 0
      let failedTotalAmount = 0
      for (const item of batch!.items) {
        const result = await this.processItem(batch!.id, item.id, senderId)
        if (result.success) {
          successCount++
        } else {
          failedCount++
          failedTotalAmount += item.amount
          this.logger.warn(
            `批次 ${batch!.batchNo} 明细 ${item.id} 处理失败：${result.reason}`,
          )
        }
      }

      // 3. 收尾：失败笔数金额退回 + 标记 COMPLETED
      const finalBatch = await this.prisma.$transaction(async (tx) => {
        if (failedTotalAmount > 0) {
          const senderAccount = await tx.account.findUnique({
            where: { userId: senderId },
          })
          if (senderAccount) {
            const releaseResult = await tx.account.updateMany({
              where: {
                id: senderAccount.id,
                frozenBalance: { gte: failedTotalAmount },
              },
              data: {
                availableBalance: { increment: failedTotalAmount },
                frozenBalance: { decrement: failedTotalAmount },
              },
            })
            if (releaseResult.count === 1) {
              const updatedAccount = await tx.account.findUnique({
                where: { id: senderAccount.id },
              })
              // 退款订单作为 AccountLedger.transactionId 占位
              const refundOrder = await tx.transactionOrder.create({
                data: {
                  orderNo: generateOrderNo('T'),
                  type: TransactionType.REFUND,
                  status: TransactionStatus.SUCCESS,
                  amount: failedTotalAmount,
                  fromUserId: senderId,
                  remark: `批次 ${batch!.batchNo} 失败笔数退款`,
                  completedAt: new Date(),
                },
              })
              await tx.accountLedger.create({
                data: {
                  accountId: senderAccount.id,
                  transactionId: refundOrder.id,
                  type: LedgerType.BATCH_TRANSFER,
                  amount: failedTotalAmount,
                  balanceBefore: updatedAccount!.availableBalance - failedTotalAmount,
                  balanceAfter: updatedAccount!.availableBalance,
                  direction: Direction.DEBIT,
                  remark: `批次 ${batch!.batchNo} 失败笔数退款（${failedCount} 笔）`,
                },
              })
            }
          }
        }

        // 状态机：PROCESSING → COMPLETED
        const lockResult = await tx.batchTransfer.updateMany({
          where: { id: batch!.id, status: BatchTransferStatus.PROCESSING },
          data: {
            status: BatchTransferStatus.COMPLETED,
            successCount,
            failedCount,
          },
        })
        if (lockResult.count === 0) {
          // 已被其他流程处理（不应出现），返回当前状态
          this.logger.warn(`批次 ${batch!.batchNo} 状态非 PROCESSING，无法标记 COMPLETED`)
        }

        return tx.batchTransfer.findUnique({
          where: { id: batch!.id },
          include: { items: true },
        })
      })

      // 风控频率记录（不阻塞业务）
      this.riskEngine
        .recordTransaction({
          userId: senderId,
          type: 'TRANSFER',
          amount: totalAmount,
        })
        .catch((err) => {
          this.logger.warn(`recordTransaction(BATCH_TRANSFER) 失败: ${err?.message || err}`)
        })

      return finalBatch
    })
  }

  /**
   * 处理单笔明细（独立事务）
   *
   * 成功：from sender.frozenBalance → to receiver.availableBalance + 写账本/账单/订单 + 标记 SUCCESS
   * 失败：标记 FAILED + failureReason，资金不动（统一在外层退回），事务正常提交不回滚
   *
   * 不抛异常：通过返回值告知外层处理结果，避免事务因 throw 而回滚导致 FAILED 状态丢失
   */
  private async processItem(
    batchId: string,
    itemId: string,
    senderId: string,
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const item = await tx.batchTransferItem.findUnique({
          where: { id: itemId },
        })
        if (!item) {
          return { success: false, reason: '明细不存在' }
        }
        if (item.status !== BatchItemStatus.PENDING) {
          return { success: false, reason: `明细已处理：${item.status}` }
        }

        // 校验收款人
        const toUser = await tx.user.findUnique({
          where: { id: item.toUserId },
          include: { account: true },
        })
        if (!toUser) {
          await this.markItemFailed(tx, item.id, '收款用户不存在')
          return { success: false, reason: '收款用户不存在' }
        }
        if (toUser.realNameStatus !== RealNameStatus.VERIFIED) {
          await this.markItemFailed(tx, item.id, '收款用户未实名认证')
          return { success: false, reason: '收款用户未实名认证' }
        }
        if (toUser.status === UserStatus.FROZEN || toUser.status === UserStatus.INCOME_RESTRICTED) {
          await this.markItemFailed(tx, item.id, '收款方账户禁止收款')
          return { success: false, reason: '收款方账户禁止收款' }
        }
        if (!toUser.account || toUser.account.status !== AccountStatus.ACTIVE) {
          await this.markItemFailed(tx, item.id, '收款方账户状态异常')
          return { success: false, reason: '收款方账户状态异常' }
        }

        // 校验付款方（sender）
        const senderAccount = await tx.account.findUnique({
          where: { userId: senderId },
        })
        if (!senderAccount) {
          await this.markItemFailed(tx, item.id, '付款方账户不存在')
          return { success: false, reason: '付款方账户不存在' }
        }

        // 从 sender.frozenBalance 扣减
        const releaseResult = await tx.account.updateMany({
          where: {
            id: senderAccount.id,
            frozenBalance: { gte: item.amount },
          },
          data: {
            frozenBalance: { decrement: item.amount },
            totalBalance: { decrement: item.amount },
          },
        })
        if (releaseResult.count === 0) {
          await this.markItemFailed(tx, item.id, '冻结余额不足')
          return { success: false, reason: '冻结余额不足' }
        }

        // 加到 receiver.availableBalance
        const updatedReceiver = await tx.account.update({
          where: { id: toUser.account.id },
          data: {
            availableBalance: { increment: item.amount },
            totalBalance: { increment: item.amount },
          },
        })

        // 生成订单
        const orderNo = generateOrderNo('T')
        const order = await tx.transactionOrder.create({
          data: {
            orderNo,
            type: TransactionType.TRANSFER,
            status: TransactionStatus.SUCCESS,
            amount: item.amount,
            fromUserId: senderId,
            toUserId: item.toUserId,
            remark: '批量转账',
            completedAt: new Date(),
          },
        })

        // 账本：sender frozenBalance 扣减
        const updatedSender = await tx.account.findUnique({
          where: { id: senderAccount.id },
        })
        await tx.accountLedger.create({
          data: {
            accountId: senderAccount.id,
            transactionId: order.id,
            type: LedgerType.BATCH_TRANSFER,
            amount: item.amount,
            balanceBefore: updatedSender!.frozenBalance + item.amount,
            balanceAfter: updatedSender!.frozenBalance,
            direction: Direction.CREDIT,
            remark: `批量转账付给 ${toUser.nickname}`,
          },
        })

        // 账本：receiver availableBalance 增加
        await tx.accountLedger.create({
          data: {
            accountId: toUser.account.id,
            transactionId: order.id,
            type: LedgerType.BATCH_TRANSFER,
            amount: item.amount,
            balanceBefore: updatedReceiver.availableBalance - item.amount,
            balanceAfter: updatedReceiver.availableBalance,
            direction: Direction.DEBIT,
            remark: '批量转账收款',
          },
        })

        // 账单：sender 支出 / receiver 收入
        const sender = await tx.user.findUnique({
          where: { id: senderId },
          select: { nickname: true },
        })
        await tx.bill.create({
          data: {
            userId: senderId,
            transactionId: order.id,
            type: BillType.TRANSFER,
            direction: BillDirection.EXPENSE,
            amount: item.amount,
            counterparty: toUser.nickname,
            remark: '批量转账',
          },
        })
        await tx.bill.create({
          data: {
            userId: item.toUserId,
            transactionId: order.id,
            type: BillType.RECEIPT,
            direction: BillDirection.INCOME,
            amount: item.amount,
            counterparty: sender?.nickname || '',
            remark: '批量转账收款',
          },
        })

        // 标记明细 SUCCESS + 关联 transactionId
        await tx.batchTransferItem.updateMany({
          where: { id: item.id, status: BatchItemStatus.PENDING },
          data: {
            status: BatchItemStatus.SUCCESS,
            transactionId: order.id,
          },
        })
        return { success: true }
      })
      return result
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // 事务回滚后，明细状态保持 PENDING；重新标记为 FAILED（独立事务）
      try {
        await this.prisma.batchTransferItem.updateMany({
          where: { id: itemId, status: BatchItemStatus.PENDING },
          data: {
            status: BatchItemStatus.FAILED,
            failureReason: `处理异常：${reason}`.slice(0, 200),
          },
        })
      } catch (markErr) {
        this.logger.error(`明细 ${itemId} 标记 FAILED 失败: ${markErr}`)
      }
      return { success: false, reason }
    }
  }

  /** 标记明细失败（事务内） */
  private async markItemFailed(
    tx: Prisma.TransactionClient,
    itemId: string,
    reason: string,
  ): Promise<void> {
    await tx.batchTransferItem.updateMany({
      where: { id: itemId, status: BatchItemStatus.PENDING },
      data: {
        status: BatchItemStatus.FAILED,
        failureReason: reason.slice(0, 200),
      },
    })
  }

  /** 查询批次详情 */
  async findByBatchNo(userId: string, batchNo: string) {
    const batch = await this.prisma.batchTransfer.findUnique({
      where: { batchNo },
      include: { items: true },
    })
    if (!batch) throw new NotFoundException(kbError(KBErrorCodes.BATCH_TRANSFER_NOT_FOUND))
    if (batch.senderId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该批次'))
    }
    return batch
  }

  /** 列出当前用户的批次 */
  async list(
    userId: string,
    query: { status?: string; page?: number; limit?: number },
  ) {
    const where: Prisma.BatchTransferWhereInput = { senderId: userId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.batchTransfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.batchTransfer.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /**
   * 取消批次：仅 PENDING/PROCESSING 状态可取消
   *
   * 实际上 createBatch 内 PENDING 立即转 PROCESSING 并逐笔处理，
   * 完成后转 COMPLETED；故 cancel 主要用于在 PROCESSING 异常中断时
   * 让管理员/系统手动取消未处理明细。
   * 已 SUCCESS 的明细资金不退回，仅取消 PENDING 明细对应的冻结资金。
   */
  async cancel(userId: string, batchNo: string) {
    return this.redis.withLock(
      `batch-transfer:cancel:${batchNo}`,
      REDIS_LOCK_TTL_SECONDS,
      () =>
        this.prisma.$transaction(async (tx) => {
          const batch = await tx.batchTransfer.findUnique({
            where: { batchNo },
            include: { items: true },
          })
          if (!batch) throw new NotFoundException(kbError(KBErrorCodes.BATCH_TRANSFER_NOT_FOUND))
          if (batch.senderId !== userId) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该批次'))
          }
          if (
            batch.status !== BatchTransferStatus.PENDING &&
            batch.status !== BatchTransferStatus.PROCESSING
          ) {
            throw new BadRequestException(kbError(KBErrorCodes.BATCH_TRANSFER_NOT_CANCELLABLE))
          }

          // 取消未处理的明细：将 PENDING 标记为 FAILED
          const pendingItems = batch.items.filter(
            (i) => i.status === BatchItemStatus.PENDING,
          )
          let refundAmount = 0
          for (const item of pendingItems) {
            await tx.batchTransferItem.updateMany({
              where: { id: item.id, status: BatchItemStatus.PENDING },
              data: {
                status: BatchItemStatus.FAILED,
                failureReason: '批次已取消',
              },
            })
            refundAmount += item.amount
          }

          // 退回未处理明细对应的冻结资金
          if (refundAmount > 0) {
            const senderAccount = await tx.account.findUnique({
              where: { userId: batch.senderId },
            })
            if (senderAccount) {
              const releaseResult = await tx.account.updateMany({
                where: {
                  id: senderAccount.id,
                  frozenBalance: { gte: refundAmount },
                },
                data: {
                  availableBalance: { increment: refundAmount },
                  frozenBalance: { decrement: refundAmount },
                },
              })
              if (releaseResult.count === 1) {
                const updated = await tx.account.findUnique({
                  where: { id: senderAccount.id },
                })
                // 退款订单作为 AccountLedger.transactionId 占位
                const refundOrder = await tx.transactionOrder.create({
                  data: {
                    orderNo: generateOrderNo('T'),
                    type: TransactionType.REFUND,
                    status: TransactionStatus.SUCCESS,
                    amount: refundAmount,
                    fromUserId: batch.senderId,
                    remark: `批次 ${batchNo} 取消退款`,
                    completedAt: new Date(),
                  },
                })
                await tx.accountLedger.create({
                  data: {
                    accountId: senderAccount.id,
                    transactionId: refundOrder.id,
                    type: LedgerType.BATCH_TRANSFER,
                    amount: refundAmount,
                    balanceBefore: updated!.availableBalance - refundAmount,
                    balanceAfter: updated!.availableBalance,
                    direction: Direction.DEBIT,
                    remark: `批次 ${batchNo} 取消，退回未处理明细资金`,
                  },
                })
              }
            }
          }

          // 重新统计计数
          const finalItems = await tx.batchTransferItem.findMany({
            where: { batchId: batch.id },
          })
          const successCount = finalItems.filter(
            (i) => i.status === BatchItemStatus.SUCCESS,
          ).length
          const failedCount = finalItems.filter(
            (i) => i.status === BatchItemStatus.FAILED,
          ).length

          // 状态机：PENDING/PROCESSING → CANCELLED
          await tx.batchTransfer.updateMany({
            where: {
              id: batch.id,
              status: {
                in: [BatchTransferStatus.PENDING, BatchTransferStatus.PROCESSING],
              },
            },
            data: {
              status: BatchTransferStatus.CANCELLED,
              successCount,
              failedCount,
            },
          })

          return tx.batchTransfer.findUnique({
            where: { id: batch.id },
            include: { items: true },
          })
        }),
    )
  }
}
