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
  EscrowStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  UserStatus,
  RiskLevel,
  RiskEventType,
  AccountStatus,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  DEFAULT_ESCROW_DAILY_LIMIT_CENTS,
  ESCROW_AUTO_CONFIRM_MS,
  ESCROW_PAY_DEADLINE_MS,
  LARGE_ESCROW_THRESHOLD_CENTS,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'

/**
 * 担保交易 Escrow 服务
 *
 * 资金流：
 *  1. create: 仅落 CREATED 订单，不扣款
 *  2. pay: 买家扣 availableBalance → 入 buyer 自己的 frozenBalance（资金仍属于买家，仅冻结）
 *  3. confirm: 买家确认收货，从买家 frozenBalance → 卖家 availableBalance（放款）
 *  4. refund: 退款，从买家 frozenBalance → 买家 availableBalance（解冻回滚）
 *  5. cancel: CREATED 状态可取消（仅删除订单，无资金流动）
 *  6. expire: CREATED 状态超时未付款 → EXPIRED
 *  7. auto-confirm: SHIPPED 状态超过 ESCROW_AUTO_CONFIRM_MS → 自动放款给卖家
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  /** 买家创建担保订单（不扣款） */
  async create(
    buyerId: string,
    dto: {
      sellerId: string
      amount: number
      subject: string
      body?: string
      idempotencyKey?: string
    },
  ) {
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.ORDER_AMOUNT_INVALID))
    }
    if (buyerId === dto.sellerId) {
      throw new BadRequestException(kbError(KBErrorCodes.ESCROW_CANNOT_SELF))
    }

    const buyer = await this.usersService.findById(buyerId)
    if (!buyer) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (buyer.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (buyer.status === UserStatus.FROZEN || buyer.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户状态异常，无法发起担保交易'))
    }
    if (buyer.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '高风险用户无法发起担保交易'))
    }

    const seller = await this.usersService.findById(dto.sellerId)
    if (!seller) throw new NotFoundException(kbError(KBErrorCodes.PAYEE_NOT_FOUND))
    if (seller.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.PAYEE_NOT_VERIFIED))
    }
    if (seller.status === UserStatus.FROZEN || seller.status === UserStatus.INCOME_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '对方账户当前禁止收款'))
    }

    return this.redis.withLock(
      `escrow:create:${buyerId}`,
      REDIS_LOCK_TTL_SECONDS,
      () =>
        this.prisma.$transaction(async (tx) => {
          if (dto.idempotencyKey) {
            const existing = await tx.escrowOrder.findUnique({
              where: { idempotencyKey: dto.idempotencyKey },
            })
            if (existing) {
              if (existing.buyerId !== buyerId) {
                throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
              }
              return existing
            }
          }

          const amount = yuanToFen(dto.amount)
          const orderNo = generateOrderNo('E')
          const expiredAt = new Date(Date.now() + ESCROW_PAY_DEADLINE_MS)

          const order = await tx.escrowOrder.create({
            data: {
              orderNo,
              buyerId,
              sellerId: dto.sellerId,
              amount,
              fee: 0,
              subject: dto.subject,
              body: dto.body,
              status: EscrowStatus.CREATED,
              expiredAt,
              idempotencyKey: dto.idempotencyKey,
            },
          })

          return order
        }),
    )
  }

  /** 买家付款（资金冻结到买家自己账户的 frozenBalance） */
  async pay(buyerId: string, orderNo: string, payPassword: string) {
    return this.redis.withLock(
      `escrow:pay:${orderNo}`,
      REDIS_LOCK_TTL_SECONDS,
      () =>
        this.prisma.$transaction(async (tx) => {
          const order = await tx.escrowOrder.findUnique({
            where: { orderNo },
            include: {
              buyer: { select: { nickname: true } },
              seller: { select: { nickname: true } },
            },
          })
          if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
          if (order.buyerId !== buyerId) {
            throw new ForbiddenException(kbError(KBErrorCodes.ESCROW_BUYER_ONLY))
          }
          if (order.status !== EscrowStatus.CREATED) {
            throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID))
          }
          if (order.expiredAt && order.expiredAt < new Date()) {
            // 标记为 EXPIRED，前端看到的状态更明确
            await tx.escrowOrder.update({
              where: { id: order.id },
              data: {
                status: EscrowStatus.EXPIRED,
                cancelledAt: new Date(),
              },
            })
            throw new BadRequestException(kbError(KBErrorCodes.ESCROW_EXPIRED))
          }

          // 实名与支付密码校验
          await this.usersService.verifyPayPassword(buyerId, payPassword)

          // 风控
          const riskResult = await this.riskEngine.check({
            userId: buyerId,
            type: 'TRANSFER',
            amount: order.amount,
          })
          if (riskResult.blocked) {
            throw new ForbiddenException(
              kbError(
                KBErrorCodes.FORBIDDEN,
                `担保交易被风控拦截：${riskResult.rules
                  .filter((r) => r.action === 'BLOCK')
                  .map((r) => r.name)
                  .join('、')}`,
              ),
            )
          }

          // 单日限额
          const dateStr = new Date().toISOString().slice(0, 10)
          const limitConfig = await tx.systemConfig.findUnique({
            where: { key: 'escrow_daily_limit' },
          })
          const limit = limitConfig
            ? Math.round(Number(limitConfig.value) * 100)
            : DEFAULT_ESCROW_DAILY_LIMIT_CENTS
          await this.usersService.checkAndIncrementDailyLimit(
            tx,
            buyerId,
            'ESCROW',
            dateStr,
            order.amount,
            limit,
          )

          // 资金冻结：买家 availableBalance → frozenBalance（资金仍属于买家）
          const buyerAccount = await tx.account.findUnique({
            where: { userId: buyerId },
          })
          if (!buyerAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
          if (buyerAccount.status !== AccountStatus.ACTIVE) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '买家账户状态异常'))
          }

          const deductResult = await tx.account.updateMany({
            where: {
              id: buyerAccount.id,
              availableBalance: { gte: order.amount },
            },
            data: {
              availableBalance: { decrement: order.amount },
              frozenBalance: { increment: order.amount },
            },
          })
          if (deductResult.count === 0) {
            throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
          }

          const updatedBuyerAccount = await tx.account.findUnique({
            where: { id: buyerAccount.id },
          })

          // 乐观锁：CREATED → PAID
          const lockResult = await tx.escrowOrder.updateMany({
            where: { id: order.id, status: EscrowStatus.CREATED },
            data: {
              status: EscrowStatus.PAID,
              paidAt: new Date(),
            },
          })
          if (lockResult.count === 0) {
            throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_CHANGED))
          }

          // 账本：buyer 余额扣减
          const balanceAfter = updatedBuyerAccount!.availableBalance
          const balanceBefore = balanceAfter + order.amount
          await tx.accountLedger.create({
            data: {
              accountId: buyerAccount.id,
              transactionId: order.id,
              type: LedgerType.ESCROW,
              amount: order.amount,
              balanceBefore,
              balanceAfter,
              direction: Direction.CREDIT,
              remark: `担保交易付款给 ${order.seller.nickname}`,
            },
          })

          // 账单
          await tx.bill.create({
            data: {
              userId: buyerId,
              transactionId: order.id,
              type: BillType.ESCROW,
              direction: BillDirection.EXPENSE,
              amount: order.amount,
              counterparty: order.seller.nickname,
              remark: order.subject,
            },
          })

          // 大额担保告警
          if (order.amount > LARGE_ESCROW_THRESHOLD_CENTS) {
            await tx.riskEvent.create({
              data: {
                userId: buyerId,
                type: RiskEventType.LARGE_TRANSFER,
                level: RiskLevel.MEDIUM,
                description: `大额担保交易付款 ${fenToYuan(order.amount)} 元`,
              },
            })
          }

          const updated = await tx.escrowOrder.findUnique({ where: { id: order.id } })
          return updated
        }),
    ).then((result) => {
      this.riskEngine
        .recordTransaction({
          userId: buyerId,
          type: 'TRANSFER',
          amount: result!.amount,
        })
        .catch((err) => {
          this.logger.warn(`recordTransaction(ESCROW pay) 失败: ${err?.message || err}`)
        })
      return result
    })
  }

  /** 卖家标记已发货 */
  async ship(sellerId: string, orderNo: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.escrowOrder.findUnique({ where: { orderNo } })
      if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
      if (order.sellerId !== sellerId) {
        throw new ForbiddenException(kbError(KBErrorCodes.ESCROW_SELLER_ONLY))
      }
      if (order.status !== EscrowStatus.PAID) {
        throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID))
      }
      const lockResult = await tx.escrowOrder.updateMany({
        where: { id: order.id, status: EscrowStatus.PAID },
        data: {
          status: EscrowStatus.SHIPPED,
          shippedAt: new Date(),
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.ESCROW_ALREADY_HANDLED))
      }
      return tx.escrowOrder.findUnique({ where: { id: order.id } })
    })
  }

  /** 买家确认收货（放款给卖家） */
  async confirm(buyerId: string, orderNo: string) {
    return this.redis.withLock(
      `escrow:confirm:${orderNo}`,
      REDIS_LOCK_TTL_SECONDS,
      () =>
        this.prisma.$transaction(async (tx) => {
          const order = await tx.escrowOrder.findUnique({
            where: { orderNo },
            include: {
              buyer: { select: { nickname: true } },
              seller: { select: { nickname: true } },
            },
          })
          if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
          if (order.buyerId !== buyerId) {
            throw new ForbiddenException(kbError(KBErrorCodes.ESCROW_BUYER_ONLY))
          }
          if (order.status !== EscrowStatus.SHIPPED) {
            throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID))
          }

          const buyerAccount = await tx.account.findUnique({
            where: { userId: order.buyerId },
          })
          if (!buyerAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

          const sellerAccount = await tx.account.findUnique({
            where: { userId: order.sellerId },
          })
          if (!sellerAccount) {
            throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '卖家账户不存在'))
          }

          // 1) 买家 frozenBalance 扣减
          const releaseResult = await tx.account.updateMany({
            where: {
              id: buyerAccount.id,
              frozenBalance: { gte: order.amount },
            },
            data: {
              frozenBalance: { decrement: order.amount },
              totalBalance: { decrement: order.amount },
            },
          })
          if (releaseResult.count === 0) {
            throw new BadRequestException(kbError(KBErrorCodes.FROZEN_BALANCE_INSUFFICIENT))
          }

          // 2) 卖家 availableBalance 增加
          const updatedSeller = await tx.account.update({
            where: { id: sellerAccount.id },
            data: {
              availableBalance: { increment: order.amount },
              totalBalance: { increment: order.amount },
            },
          })

          // 3) 订单状态 SHIPPED → RECEIVED
          const lockResult = await tx.escrowOrder.updateMany({
            where: { id: order.id, status: EscrowStatus.SHIPPED },
            data: {
              status: EscrowStatus.RECEIVED,
              receivedAt: new Date(),
            },
          })
          if (lockResult.count === 0) {
            throw new BadRequestException(kbError(KBErrorCodes.ESCROW_ALREADY_HANDLED))
          }

          // 账本：buyer 冻结余额扣减
          const updatedBuyerAccount = await tx.account.findUnique({
            where: { id: buyerAccount.id },
          })
          await tx.accountLedger.create({
            data: {
              accountId: buyerAccount.id,
              transactionId: order.id,
              type: LedgerType.ESCROW_RELEASE,
              amount: order.amount,
              balanceBefore: updatedBuyerAccount!.frozenBalance + order.amount,
              balanceAfter: updatedBuyerAccount!.frozenBalance,
              direction: Direction.CREDIT,
              remark: `担保交易确认收货，放款给 ${order.seller.nickname}`,
            },
          })

          // 账本：seller 可用余额增加
          await tx.accountLedger.create({
            data: {
              accountId: sellerAccount.id,
              transactionId: order.id,
              type: LedgerType.ESCROW_RELEASE,
              amount: order.amount,
              balanceBefore: updatedSeller.availableBalance - order.amount,
              balanceAfter: updatedSeller.availableBalance,
              direction: Direction.DEBIT,
              remark: `收到 ${order.buyer.nickname} 的担保交易放款`,
            },
          })

          // 账单
          await tx.bill.create({
            data: {
              userId: order.sellerId,
              transactionId: order.id,
              type: BillType.ESCROW_INCOME,
              direction: BillDirection.INCOME,
              amount: order.amount,
              counterparty: order.buyer.nickname,
              remark: order.subject,
            },
          })

          return tx.escrowOrder.findUnique({ where: { id: order.id } })
        }),
    )
  }

  /** 买家申请退款（仅 SHIPPED 状态可申请） */
  async requestRefund(buyerId: string, orderNo: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.escrowOrder.findUnique({ where: { orderNo } })
      if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
      if (order.buyerId !== buyerId) {
        throw new ForbiddenException(kbError(KBErrorCodes.ESCROW_BUYER_ONLY))
      }
      if (order.status !== EscrowStatus.SHIPPED) {
        throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID))
      }
      const lockResult = await tx.escrowOrder.updateMany({
        where: { id: order.id, status: EscrowStatus.SHIPPED },
        data: {
          status: EscrowStatus.REFUND_REQUESTED,
          refundReason: reason,
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.ESCROW_ALREADY_HANDLED))
      }
      return tx.escrowOrder.findUnique({ where: { id: order.id } })
    })
  }

  /**
   * 卖家处理退款申请
   * @param decision APPROVE_REFUND（同意退款） / REJECT_REFUND（拒绝，资金放给卖家）
   */
  async resolveRefund(
    sellerId: string,
    orderNo: string,
    decision: 'APPROVE_REFUND' | 'REJECT_REFUND',
    reason?: string,
  ) {
    return this.redis.withLock(
      `escrow:resolve:${orderNo}`,
      REDIS_LOCK_TTL_SECONDS,
      () =>
        this.prisma.$transaction(async (tx) => {
          const order = await tx.escrowOrder.findUnique({
            where: { orderNo },
            include: {
              buyer: { select: { nickname: true } },
              seller: { select: { nickname: true } },
            },
          })
          if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
          if (order.sellerId !== sellerId) {
            throw new ForbiddenException(kbError(KBErrorCodes.ESCROW_SELLER_ONLY))
          }
          if (order.status !== EscrowStatus.REFUND_REQUESTED) {
            throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID))
          }

          if (decision === 'APPROVE_REFUND') {
            // 资金从买家 frozenBalance → 买家 availableBalance
            const buyerAccount = await tx.account.findUnique({
              where: { userId: order.buyerId },
            })
            if (!buyerAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

            const releaseResult = await tx.account.updateMany({
              where: {
                id: buyerAccount.id,
                frozenBalance: { gte: order.amount },
              },
              data: {
                availableBalance: { increment: order.amount },
                frozenBalance: { decrement: order.amount },
              },
            })
            if (releaseResult.count === 0) {
              throw new BadRequestException(kbError(KBErrorCodes.FROZEN_BALANCE_INSUFFICIENT))
            }

            const updatedBuyer = await tx.account.findUnique({
              where: { id: buyerAccount.id },
            })

            const lockResult = await tx.escrowOrder.updateMany({
              where: { id: order.id, status: EscrowStatus.REFUND_REQUESTED },
              data: {
                status: EscrowStatus.REFUNDED,
                refundedAt: new Date(),
                refundReason: reason || order.refundReason,
              },
            })
            if (lockResult.count === 0) {
              throw new BadRequestException(kbError(KBErrorCodes.ESCROW_ALREADY_HANDLED))
            }

            await tx.accountLedger.create({
              data: {
                accountId: buyerAccount.id,
                transactionId: order.id,
                type: LedgerType.ESCROW_REFUND,
                amount: order.amount,
                balanceBefore: updatedBuyer!.availableBalance - order.amount,
                balanceAfter: updatedBuyer!.availableBalance,
                direction: Direction.DEBIT,
                remark: `卖家 ${order.seller.nickname} 同意退款`,
              },
            })

            await tx.bill.create({
              data: {
                userId: order.buyerId,
                transactionId: order.id,
                type: BillType.ESCROW_REFUND,
                direction: BillDirection.INCOME,
                amount: order.amount,
                counterparty: order.seller.nickname,
                remark: '担保交易退款',
              },
            })
          } else {
            // 拒绝退款：资金放给卖家（相当于确认收货）
            const buyerAccount = await tx.account.findUnique({
              where: { userId: order.buyerId },
            })
            if (!buyerAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
            const sellerAccount = await tx.account.findUnique({
              where: { userId: order.sellerId },
            })
            if (!sellerAccount) {
              throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '卖家账户不存在'))
            }

            const releaseResult = await tx.account.updateMany({
              where: {
                id: buyerAccount.id,
                frozenBalance: { gte: order.amount },
              },
              data: {
                frozenBalance: { decrement: order.amount },
                totalBalance: { decrement: order.amount },
              },
            })
            if (releaseResult.count === 0) {
              throw new BadRequestException(kbError(KBErrorCodes.FROZEN_BALANCE_INSUFFICIENT))
            }

            const updatedSeller = await tx.account.update({
              where: { id: sellerAccount.id },
              data: {
                availableBalance: { increment: order.amount },
                totalBalance: { increment: order.amount },
              },
            })

            const lockResult = await tx.escrowOrder.updateMany({
              where: { id: order.id, status: EscrowStatus.REFUND_REQUESTED },
              data: {
                status: EscrowStatus.RECEIVED,
                receivedAt: new Date(),
                refundReason: reason || order.refundReason,
              },
            })
            if (lockResult.count === 0) {
              throw new BadRequestException(kbError(KBErrorCodes.ESCROW_ALREADY_HANDLED))
            }

            const updatedBuyer = await tx.account.findUnique({
              where: { id: buyerAccount.id },
            })
            await tx.accountLedger.create({
              data: {
                accountId: buyerAccount.id,
                transactionId: order.id,
                type: LedgerType.ESCROW_RELEASE,
                amount: order.amount,
                balanceBefore: updatedBuyer!.frozenBalance + order.amount,
                balanceAfter: updatedBuyer!.frozenBalance,
                direction: Direction.CREDIT,
                remark: `卖家 ${order.seller.nickname} 拒绝退款，资金放给卖家`,
              },
            })
            await tx.accountLedger.create({
              data: {
                accountId: sellerAccount.id,
                transactionId: order.id,
                type: LedgerType.ESCROW_RELEASE,
                amount: order.amount,
                balanceBefore: updatedSeller.availableBalance - order.amount,
                balanceAfter: updatedSeller.availableBalance,
                direction: Direction.DEBIT,
                remark: `买家 ${order.buyer.nickname} 退款被拒绝，收到放款`,
              },
            })

            await tx.bill.create({
              data: {
                userId: order.sellerId,
                transactionId: order.id,
                type: BillType.ESCROW_INCOME,
                direction: BillDirection.INCOME,
                amount: order.amount,
                counterparty: order.buyer.nickname,
                remark: order.subject,
              },
            })
          }

          return tx.escrowOrder.findUnique({ where: { id: order.id } })
        }),
    )
  }

  /** 买家取消订单（仅 CREATED 状态可取消，无资金流动） */
  async cancel(buyerId: string, orderNo: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.escrowOrder.findUnique({ where: { orderNo } })
      if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
      if (order.buyerId !== buyerId) {
        throw new ForbiddenException(kbError(KBErrorCodes.ESCROW_BUYER_ONLY))
      }
      if (order.status !== EscrowStatus.CREATED) {
        throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID))
      }
      const lockResult = await tx.escrowOrder.updateMany({
        where: { id: order.id, status: EscrowStatus.CREATED },
        data: {
          status: EscrowStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.ESCROW_ALREADY_HANDLED))
      }
      return tx.escrowOrder.findUnique({ where: { id: order.id } })
    })
  }

  /** 查询订单详情 */
  async findByOrderNo(userId: string, orderNo: string) {
    const order = await this.prisma.escrowOrder.findUnique({
      where: { orderNo },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ESCROW_ORDER_NOT_FOUND))
    // 买家/卖家可见，否则拒绝
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该订单'))
    }
    return order
  }

  /** 列出当前用户的担保订单 */
  async list(
    userId: string,
    query: { role?: 'buyer' | 'seller' | 'all'; status?: string },
  ) {
    const role = query.role || 'all'
    const where: Prisma.EscrowOrderWhereInput = {}
    if (role === 'buyer') where.buyerId = userId
    else if (role === 'seller') where.sellerId = userId
    if (query.status) where.status = query.status

    return this.prisma.escrowOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  }

  /** 调度：自动取消超时未付款订单 */
  async autoExpire() {
    const now = new Date()
    const expired = await this.prisma.escrowOrder.findMany({
      where: {
        status: EscrowStatus.CREATED,
        expiredAt: { lt: now },
      },
      select: { id: true, orderNo: true },
    })
    for (const order of expired) {
      try {
        await this.prisma.escrowOrder.updateMany({
          where: { id: order.id, status: EscrowStatus.CREATED },
          data: {
            status: EscrowStatus.EXPIRED,
            cancelledAt: now,
          },
        })
        this.logger.log(`担保订单 ${order.orderNo} 超时未付款，已自动取消`)
      } catch (err) {
        this.logger.error(`担保订单 ${order.orderNo} 自动取消失败`, err)
      }
    }
    return expired.length
  }

  /** 调度：发货后超时自动确认收货（放款给卖家） */
  async autoConfirm() {
    const threshold = new Date(Date.now() - ESCROW_AUTO_CONFIRM_MS)
    const candidates = await this.prisma.escrowOrder.findMany({
      where: {
        status: EscrowStatus.SHIPPED,
        shippedAt: { lt: threshold },
      },
      select: { id: true, orderNo: true, buyerId: true },
    })
    let success = 0
    for (const order of candidates) {
      try {
        await this.confirm(order.buyerId, order.orderNo)
        success++
        this.logger.log(`担保订单 ${order.orderNo} 发货后超时未确认，已自动放款给卖家`)
      } catch (err) {
        this.logger.error(`担保订单 ${order.orderNo} 自动放款失败`, err)
      }
    }
    return success
  }
}
