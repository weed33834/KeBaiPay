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
  SubscriptionPeriod,
  SubscriptionStatus,
  SubscriptionPlanStatus,
  SubscriptionChargeStatus,
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
  DEFAULT_SUBSCRIPTION_DAILY_LIMIT_CENTS,
  LARGE_SUBSCRIPTION_THRESHOLD_CENTS,
  MAX_SUBSCRIPTIONS_PER_USER,
  REDIS_LOCK_TTL_SECONDS,
  SUBSCRIPTION_MAX_FAILURES,
} from '../common/constants'
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto'
import { SubscribeDto } from './dto/subscribe.dto'

/**
 * 计算下一个周期结束时间
 * @param start 周期开始时间
 * @param period 周期类型
 * @param intervalCount 间隔数
 */
function addPeriod(start: Date, period: string, intervalCount: number): Date {
  const d = new Date(start)
  const n = Math.max(1, intervalCount)
  switch (period) {
    case SubscriptionPeriod.DAILY:
      d.setDate(d.getDate() + n)
      break
    case SubscriptionPeriod.WEEKLY:
      d.setDate(d.getDate() + 7 * n)
      break
    case SubscriptionPeriod.MONTHLY:
      d.setMonth(d.getMonth() + n)
      break
    case SubscriptionPeriod.YEARLY:
      d.setFullYear(d.getFullYear() + n)
      break
    default:
      d.setMonth(d.getMonth() + n)
  }
  return d
}

/**
 * 订阅/周期扣款服务
 *
 * 资金流：
 *  1. subscribe：用户首次订阅 → 立即扣首期款（subscriber → owner）→ 设置 nextChargeAt
 *  2. autoCharge：调度扫描 nextChargeAt < now 的订阅 → 扣款 + 推进周期
 *  3. cancel：取消订阅（不影响已扣款），不再扣款
 *  4. suspend/resume：暂停/恢复（不扣款 / 恢复扣款）
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  // ============== 订阅计划管理 ==============

  /** 创建订阅计划 */
  async createPlan(ownerId: string, dto: CreateSubscriptionPlanDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_AMOUNT_INVALID))
    }
    const owner = await this.usersService.findById(ownerId)
    if (!owner) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (owner.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }

    const amount = yuanToFen(dto.amount)
    const planNo = generateOrderNo('SP')
    return this.prisma.subscriptionPlan.create({
      data: {
        planNo,
        ownerId,
        name: dto.name,
        description: dto.description,
        amount,
        period: dto.period,
        intervalCount: dto.intervalCount || 1,
        trialDays: dto.trialDays || 0,
        totalCycles: dto.totalCycles ?? null,
        status: SubscriptionPlanStatus.ACTIVE,
      },
    })
  }

  /** 查询计划详情 */
  async findPlanByNo(planNo: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { planNo },
    })
    if (!plan) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND))
    return plan
  }

  /** 列出当前用户的订阅计划 */
  async listPlans(ownerId: string, query: { status?: string; page?: number; limit?: number }) {
    const where: Prisma.SubscriptionPlanWhereInput = { ownerId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 启用/禁用计划 */
  async setPlanStatus(ownerId: string, planNo: string, status: 'ACTIVE' | 'DISABLED') {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { planNo } })
    if (!plan) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND))
    if (plan.ownerId !== ownerId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该计划'))
    }
    if (plan.status === status) {
      throw new BadRequestException(kbError(KBErrorCodes.ESCROW_STATUS_INVALID, '状态未变化'))
    }
    return this.prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { status },
    })
  }

  // ============== 用户订阅管理 ==============

  /** 用户订阅计划（立即扣首期款） */
  async subscribe(subscriberId: string, planNo: string, dto: SubscribeDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { planNo },
    })
    if (!plan) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_PLAN_NOT_FOUND))
    if (plan.status !== SubscriptionPlanStatus.ACTIVE) {
      throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_PLAN_DISABLED))
    }
    if (plan.ownerId === subscriberId) {
      throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_CANNOT_SELF_SUBSCRIBE))
    }

    // 校验订阅者
    const subscriber = await this.usersService.findById(subscriberId)
    if (!subscriber) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (subscriber.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (subscriber.status === UserStatus.FROZEN || subscriber.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户状态异常，无法订阅'))
    }
    if (subscriber.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '高风险用户无法订阅'))
    }

    // 校验 owner 收款方
    const owner = await this.usersService.findById(plan.ownerId)
    if (!owner) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (owner.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.PAYEE_NOT_VERIFIED))
    }
    if (owner.status === UserStatus.FROZEN || owner.status === UserStatus.INCOME_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '对方账户当前禁止收款'))
    }

    // 校验支付密码
    if (dto.payPassword) {
      await this.usersService.verifyPayPassword(subscriberId, dto.payPassword)
    }

    // 风控
    const riskResult = await this.riskEngine.check({
      userId: subscriberId,
      type: 'TRANSFER',
      amount: plan.amount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `订阅被风控拦截：${riskResult.rules
            .filter((r) => r.action === 'BLOCK')
            .map((r) => r.name)
            .join('、')}`,
        ),
      )
    }

    const lockKey = dto.idempotencyKey
      ? `subscribe:idem:${dto.idempotencyKey}`
      : `subscribe:user:${subscriberId}:${plan.id}`

    return this.redis.withLock(lockKey, REDIS_LOCK_TTL_SECONDS, async () => {
      return this.prisma.$transaction(async (tx) => {
        // 幂等：命中已有订阅则直接返回
        if (dto.idempotencyKey) {
          const existing = await tx.subscription.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          })
          if (existing) {
            if (existing.subscriberId !== subscriberId) {
              throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
            }
            return existing
          }
        }

        // 已订阅该计划且仍活跃则拒绝重复订阅
        const activeExisting = await tx.subscription.findFirst({
          where: {
            subscriberId,
            planId: plan.id,
            status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] },
          },
        })
        if (activeExisting) {
          throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_ALREADY_EXISTS))
        }

        // 单用户订阅计划数上限
        const userSubCount = await tx.subscription.count({
          where: { subscriberId },
        })
        if (userSubCount >= MAX_SUBSCRIPTIONS_PER_USER) {
          throw new BadRequestException(
            kbError(KBErrorCodes.BATCH_TRANSFER_TOO_MANY, '订阅数超过上限'),
          )
        }

        // 单日限额
        const dateStr = new Date().toISOString().slice(0, 10)
        const limitConfig = await tx.systemConfig.findUnique({
          where: { key: 'subscription_daily_limit' },
        })
        const limit = limitConfig
          ? Math.round(Number(limitConfig.value) * 100)
          : DEFAULT_SUBSCRIPTION_DAILY_LIMIT_CENTS
        await this.usersService.checkAndIncrementDailyLimit(
          tx,
          subscriberId,
          'SUBSCRIPTION',
          dateStr,
          plan.amount,
          limit,
        )

        // 首期扣款
        const subscriptionNo = generateOrderNo('SUB')
        const startAt = new Date()
        const trialEnd = plan.trialDays > 0
          ? new Date(startAt.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
          : startAt

        // 试用期：不立即扣款，nextChargeAt = trialEnd
        const firstChargeAt = trialEnd
        const currentCycleStart = startAt
        const currentCycleEnd = addPeriod(currentCycleStart, plan.period, plan.intervalCount)
        const totalCyclesLimit = plan.totalCycles
        const endAt = totalCyclesLimit
          ? addPeriod(startAt, plan.period, plan.intervalCount * totalCyclesLimit)
          : null

        const subscription = await tx.subscription.create({
          data: {
            subscriptionNo,
            subscriberId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            startAt,
            currentCycleStart,
            currentCycleEnd,
            nextChargeAt: firstChargeAt,
            endAt,
            completedCycles: 0,
            idempotencyKey: dto.idempotencyKey,
          },
        })

        // 试用期不立即扣款，等待调度
        if (plan.trialDays > 0) {
          return subscription
        }

        // 首期扣款（无试用期）
        const charge = await this.executeCharge(tx, subscription.id, {
          subscriberId,
          ownerId: plan.ownerId,
          amount: plan.amount,
          cycleStart: currentCycleStart,
          cycleEnd: currentCycleEnd,
        })

        // 更新订阅状态
        const updatedSub = await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            completedCycles: 1,
            lastChargeId: charge.id,
            nextChargeAt: addPeriod(currentCycleStart, plan.period, plan.intervalCount),
            currentCycleStart: currentCycleEnd,
            currentCycleEnd: addPeriod(currentCycleEnd, plan.period, plan.intervalCount),
            status:
              totalCyclesLimit && 1 >= totalCyclesLimit
                ? SubscriptionStatus.EXPIRED
                : SubscriptionStatus.ACTIVE,
          },
        })

        return updatedSub
      })
    })
  }

  /**
   * 执行单次订阅扣款（内部方法）
   * 必须在事务内调用
   */
  private async executeCharge(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    params: {
      subscriberId: string
      ownerId: string
      amount: number
      cycleStart: Date
      cycleEnd: Date
    },
  ) {
    const { subscriberId, ownerId, amount, cycleStart, cycleEnd } = params

    // 创建扣款记录（PENDING）
    const chargeNo = generateOrderNo('SC')
    const charge = await tx.subscriptionCharge.create({
      data: {
        chargeNo,
        subscriptionId,
        subscriberId,
        ownerId,
        amount,
        cycleStart,
        cycleEnd,
        status: SubscriptionChargeStatus.PENDING,
      },
    })

    // 校验付款方账户
    const subscriberAccount = await tx.account.findUnique({
      where: { userId: subscriberId },
    })
    if (!subscriberAccount) {
      await tx.subscriptionCharge.update({
        where: { id: charge.id },
        data: {
          status: SubscriptionChargeStatus.FAILED,
          failureReason: '付款方账户不存在',
        },
      })
      return charge
    }
    if (subscriberAccount.status !== AccountStatus.ACTIVE) {
      await tx.subscriptionCharge.update({
        where: { id: charge.id },
        data: {
          status: SubscriptionChargeStatus.FAILED,
          failureReason: '付款方账户状态异常',
        },
      })
      return charge
    }

    // 校验收款方账户
    const ownerAccount = await tx.account.findUnique({
      where: { userId: ownerId },
    })
    if (!ownerAccount) {
      await tx.subscriptionCharge.update({
        where: { id: charge.id },
        data: {
          status: SubscriptionChargeStatus.FAILED,
          failureReason: '收款方账户不存在',
        },
      })
      return charge
    }
    if (ownerAccount.status !== AccountStatus.ACTIVE) {
      await tx.subscriptionCharge.update({
        where: { id: charge.id },
        data: {
          status: SubscriptionChargeStatus.FAILED,
          failureReason: '收款方账户状态异常',
        },
      })
      return charge
    }

    // 扣款：subscriber.availableBalance → owner.availableBalance
    const deductResult = await tx.account.updateMany({
      where: {
        id: subscriberAccount.id,
        availableBalance: { gte: amount },
      },
      data: {
        availableBalance: { decrement: amount },
        totalBalance: { decrement: amount },
      },
    })
    if (deductResult.count === 0) {
      await tx.subscriptionCharge.update({
        where: { id: charge.id },
        data: {
          status: SubscriptionChargeStatus.FAILED,
          failureReason: '余额不足',
        },
      })
      return charge
    }

    const updatedSubscriber = await tx.account.findUnique({
      where: { id: subscriberAccount.id },
    })
    const updatedOwner = await tx.account.update({
      where: { id: ownerAccount.id },
      data: {
        availableBalance: { increment: amount },
        totalBalance: { increment: amount },
      },
    })

    // 创建交易订单
    const orderNo = generateOrderNo('T')
    const order = await tx.transactionOrder.create({
      data: {
        orderNo,
        type: TransactionType.TRANSFER,
        status: TransactionStatus.SUCCESS,
        amount,
        fromUserId: subscriberId,
        toUserId: ownerId,
        remark: '订阅扣款',
        completedAt: new Date(),
      },
    })

    // 账本：subscriber 扣款
    await tx.accountLedger.create({
      data: {
        accountId: subscriberAccount.id,
        transactionId: order.id,
        type: LedgerType.SUBSCRIPTION,
        amount,
        balanceBefore: updatedSubscriber!.availableBalance + amount,
        balanceAfter: updatedSubscriber!.availableBalance,
        direction: Direction.CREDIT,
        remark: '订阅扣款',
      },
    })
    // 账本：owner 收款
    await tx.accountLedger.create({
      data: {
        accountId: ownerAccount.id,
        transactionId: order.id,
        type: LedgerType.SUBSCRIPTION,
        amount,
        balanceBefore: updatedOwner.availableBalance - amount,
        balanceAfter: updatedOwner.availableBalance,
        direction: Direction.DEBIT,
        remark: '订阅收款',
      },
    })

    // 账单
    const subscriber = await tx.user.findUnique({
      where: { id: subscriberId },
      select: { nickname: true },
    })
    const owner = await tx.user.findUnique({
      where: { id: ownerId },
      select: { nickname: true },
    })
    await tx.bill.create({
      data: {
        userId: subscriberId,
        transactionId: order.id,
        type: BillType.SUBSCRIPTION,
        direction: BillDirection.EXPENSE,
        amount,
        counterparty: owner?.nickname || '',
        remark: '订阅扣款',
      },
    })
    await tx.bill.create({
      data: {
        userId: ownerId,
        transactionId: order.id,
        type: BillType.SUBSCRIPTION_INCOME,
        direction: BillDirection.INCOME,
        amount,
        counterparty: subscriber?.nickname || '',
        remark: '订阅收款',
      },
    })

    // 大额告警
    if (amount > LARGE_SUBSCRIPTION_THRESHOLD_CENTS) {
      await tx.riskEvent.create({
        data: {
          userId: subscriberId,
          type: RiskEventType.LARGE_TRANSFER,
          level: RiskLevel.MEDIUM,
          description: `大额订阅扣款 ${fenToYuan(amount)} 元`,
        },
      })
    }

    // 标记扣款成功
    return tx.subscriptionCharge.update({
      where: { id: charge.id },
      data: {
        status: SubscriptionChargeStatus.SUCCESS,
        transactionId: order.id,
        chargedAt: new Date(),
      },
    })
  }

  /** 取消订阅（不再扣款，已扣款不退回） */
  async cancel(subscriberId: string, subscriptionNo: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { subscriptionNo },
      })
      if (!sub) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_NOT_FOUND))
      if (sub.subscriberId !== subscriberId) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订阅'))
      }
      if (sub.status === SubscriptionStatus.CANCELLED) {
        throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_STATUS_INVALID))
      }
      const lockResult = await tx.subscription.updateMany({
        where: {
          id: sub.id,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED] },
        },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
          nextChargeAt: null,
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_STATUS_INVALID))
      }
      return tx.subscription.findUnique({ where: { id: sub.id } })
    })
  }

  /** 暂停订阅 */
  async suspend(subscriberId: string, subscriptionNo: string) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { subscriptionNo },
      })
      if (!sub) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_NOT_FOUND))
      if (sub.subscriberId !== subscriberId) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订阅'))
      }
      if (sub.status !== SubscriptionStatus.ACTIVE) {
        throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_STATUS_INVALID))
      }
      const lockResult = await tx.subscription.updateMany({
        where: { id: sub.id, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.SUSPENDED },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_STATUS_INVALID))
      }
      return tx.subscription.findUnique({ where: { id: sub.id } })
    })
  }

  /** 恢复订阅 */
  async resume(subscriberId: string, subscriptionNo: string) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { subscriptionNo },
        include: { plan: true },
      })
      if (!sub) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_NOT_FOUND))
      if (sub.subscriberId !== subscriberId) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订阅'))
      }
      if (sub.status !== SubscriptionStatus.SUSPENDED) {
        throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_STATUS_INVALID))
      }
      // 重新计算 nextChargeAt：若已过期则设为 now
      const now = new Date()
      const nextChargeAt = sub.nextChargeAt && sub.nextChargeAt > now
        ? sub.nextChargeAt
        : now
      const lockResult = await tx.subscription.updateMany({
        where: { id: sub.id, status: SubscriptionStatus.SUSPENDED },
        data: {
          status: SubscriptionStatus.ACTIVE,
          nextChargeAt,
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.SUBSCRIPTION_STATUS_INVALID))
      }
      return tx.subscription.findUnique({ where: { id: sub.id } })
    })
  }

  /** 查询订阅详情 */
  async findBySubscriptionNo(userId: string, subscriptionNo: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { subscriptionNo },
      include: { plan: true },
    })
    if (!sub) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_NOT_FOUND))
    // 订阅者或计划 owner 均可查看
    if (sub.subscriberId !== userId && sub.plan.ownerId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该订阅'))
    }
    return sub
  }

  /** 列出当前用户的订阅 */
  async list(userId: string, query: { status?: string; page?: number; limit?: number }) {
    const where: Prisma.SubscriptionWhereInput = { subscriberId: userId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscription.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 列出订阅扣款记录 */
  async listCharges(
    userId: string,
    subscriptionNo: string,
    query: { status?: string; page?: number; limit?: number },
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { subscriptionNo },
      include: { plan: true },
    })
    if (!sub) throw new NotFoundException(kbError(KBErrorCodes.SUBSCRIPTION_NOT_FOUND))
    if (sub.subscriberId !== userId && sub.plan.ownerId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该订阅'))
    }
    const where: Prisma.SubscriptionChargeWhereInput = { subscriptionId: sub.id }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.subscriptionCharge.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscriptionCharge.count({ where }),
    ])
    return { items, total, page, limit }
  }

  // ============== 调度：自动扣款 ==============

  /**
   * 自动扣款：扫描 status=ACTIVE 且 nextChargeAt < now 的订阅，逐个扣款
   * 由 ScheduleService 每 5 分钟调用一次
   */
  async autoCharge() {
    const now = new Date()
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        nextChargeAt: { lt: now },
      },
      include: { plan: true },
      take: 50, // 单次最多处理 50 个，防止积压
    })

    let successCount = 0
    let failCount = 0
    for (const sub of candidates) {
      try {
        await this.chargeOnce(sub.id)
        successCount++
      } catch (err) {
        failCount++
        this.logger.error(`订阅 ${sub.subscriptionNo} 自动扣款失败: ${err}`)
      }
    }
    this.logger.log(
      `订阅自动扣款完成: 总计 ${candidates.length}, 成功 ${successCount}, 失败 ${failCount}`,
    )
    return { total: candidates.length, success: successCount, failed: failCount }
  }

  /**
   * 执行一次订阅扣款（独立事务 + Redis 锁）
   */
  private async chargeOnce(subscriptionId: string) {
    return this.redis.withLock(
      `subscription:charge:${subscriptionId}`,
      REDIS_LOCK_TTL_SECONDS,
      () =>
        this.prisma.$transaction(async (tx) => {
          const sub = await tx.subscription.findUnique({
            where: { id: subscriptionId },
            include: { plan: true },
          })
          if (!sub) throw new Error('订阅不存在')
          if (sub.status !== SubscriptionStatus.ACTIVE) {
            throw new Error(`订阅状态非 ACTIVE: ${sub.status}`)
          }

          // 检查是否已达到 totalCycles
          if (sub.plan.totalCycles && sub.completedCycles >= sub.plan.totalCycles) {
            // 标记 EXPIRED
            await tx.subscription.update({
              where: { id: sub.id },
              data: {
                status: SubscriptionStatus.EXPIRED,
                nextChargeAt: null,
                endAt: new Date(),
              },
            })
            return
          }

          // 执行扣款
          const charge = await this.executeCharge(tx, sub.id, {
            subscriberId: sub.subscriberId,
            ownerId: sub.plan.ownerId,
            amount: sub.plan.amount,
            cycleStart: sub.currentCycleStart,
            cycleEnd: sub.currentCycleEnd,
          })

          // 计算下一周期
          const nextCycleStart = sub.currentCycleEnd
          const nextCycleEnd = addPeriod(
            nextCycleStart,
            sub.plan.period,
            sub.plan.intervalCount,
          )
          const newCompletedCycles = sub.completedCycles + 1
          const totalCyclesLimit = sub.plan.totalCycles
          const isExpired = totalCyclesLimit && newCompletedCycles >= totalCyclesLimit

          // 失败次数过多：自动暂停
          // 查询最近连续失败次数
          const recentCharges = await tx.subscriptionCharge.findMany({
            where: { subscriptionId: sub.id },
            orderBy: { createdAt: 'desc' },
            take: SUBSCRIPTION_MAX_FAILURES,
          })
          const allFailed = recentCharges.length >= SUBSCRIPTION_MAX_FAILURES
            && recentCharges.every(
              (c) => c.status === SubscriptionChargeStatus.FAILED,
            )

          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              completedCycles: newCompletedCycles,
              lastChargeId: charge.id,
              currentCycleStart: nextCycleStart,
              currentCycleEnd: nextCycleEnd,
              nextChargeAt: isExpired ? null : nextCycleStart,
              status: isExpired
                ? SubscriptionStatus.EXPIRED
                : allFailed
                  ? SubscriptionStatus.SUSPENDED
                  : SubscriptionStatus.ACTIVE,
              endAt: isExpired ? new Date() : sub.endAt,
            },
          })
        }),
    )
  }
}
