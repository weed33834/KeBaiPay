import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  WithdrawalStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  RiskLevel,
  RiskEventType,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { RiskEngineService } from '../risk/risk-engine.service'
import { JournalService } from '../finance/journal.service'
import { CryptoService } from '../crypto/crypto.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { DEFAULT_WITHDRAW_DAILY_LIMIT_CENTS, LARGE_WITHDRAWAL_THRESHOLD_CENTS, RATE_DENOMINATOR, REDIS_LOCK_TTL_SECONDS } from '../common/constants'

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly riskEngine: RiskEngineService,
    private readonly journalService: JournalService,
    private readonly cryptoService: CryptoService,
  ) {}

  // 商户优先使用独立提现费率（单位：万分之一），普通用户读全局配置
  async getFeeRate(userId?: string) {
    if (userId) {
      const merchant = await this.prisma.merchant.findUnique({
        where: { userId },
      })
      if (merchant && merchant.withdrawRate != null) {
        return merchant.withdrawRate / RATE_DENOMINATOR
      }
    }

    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'withdrawal_fee_rate' },
    })
    if (config) {
      return Number(config.value)
    }
    return 0.001
  }

  async create(
    userId: string,
    dto: {
      amount: number
      payPassword: string
      channelAccount?: string
      remark?: string
      idempotencyKey?: string
    },
  )
  {
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.WITHDRAWAL_AMOUNT_INVALID))
    }

    return this.redis.withLock(`withdraw:create:${userId}`, REDIS_LOCK_TTL_SECONDS, async () => {
      const user = await this.usersService.findById(userId)
      if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
      if (user.realNameStatus !== RealNameStatus.VERIFIED) {
        throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
      }
      if (user.status === 'FROZEN' || user.status === 'EXPENSE_RESTRICTED') {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户当前禁止支出'))
      }
      if (user.riskLevel === RiskLevel.HIGH) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户风险等级过高，禁止提现'))
      }
      await this.usersService.verifyPayPassword(userId, dto.payPassword)

      const amount = yuanToFen(dto.amount)
      const feeRate = await this.getFeeRate(userId)
      const fee = Math.round(amount * feeRate)
      const actualAmount = amount - fee

      // 风控检查：在冻结余额前执行，拦截则直接抛错
      const riskResult = await this.riskEngine.check({
        userId,
        type: 'WITHDRAW',
        amount,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `提现被风控拦截：${riskResult.rules
              .filter((r) => r.action === 'BLOCK')
              .map((r) => r.name)
              .join('、')}`,
          ),
        )
      }

      return this.prisma.$transaction(async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.withdrawalOrder.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        })
        if (existing) {
          // H5: 校验归属，防止不同用户使用相同 idempotencyKey 获取他人订单
          if (existing.userId !== userId) {
            throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
          }
          return existing
        }
      }

      // 单日提现限额：从 systemConfig 读取（单位元），默认 DEFAULT_WITHDRAW_DAILY_LIMIT_CENTS
      const dateStr = new Date().toISOString().slice(0, 10)
      const limitConfig = await tx.systemConfig.findUnique({
        where: { key: 'withdrawal_daily_limit' },
      })
      const withdrawLimit = limitConfig
        ? Math.round(Number(limitConfig.value) * 100)
        : DEFAULT_WITHDRAW_DAILY_LIMIT_CENTS
      // 限额校验放入事务内，保证原子性，避免高并发突破限额
      await this.usersService.checkAndIncrementDailyLimit(
        tx,
        userId,
        'WITHDRAW',
        dateStr,
        amount,
        withdrawLimit,
      )

      const account = await tx.account.findUnique({ where: { userId } })
      if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

      const freezeResult = await tx.account.updateMany({
        where: {
          id: account.id,
          availableBalance: { gte: amount },
        },
        data: {
          availableBalance: { decrement: amount },
          frozenBalance: { increment: amount },
        },
      })
      if (freezeResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
      }

      const orderNo = generateOrderNo('W')
      const order = await tx.withdrawalOrder.create({
        data: {
          orderNo,
          userId,
          amount,
          fee,
          actualAmount,
          status: WithdrawalStatus.PENDING,
          // channelAccount（银行卡号）属敏感信息，加密后入库，防止明文泄露
          channelAccount: dto.channelAccount
            ? this.cryptoService.encrypt(dto.channelAccount)
            : dto.channelAccount,
          remark: dto.remark,
          idempotencyKey: dto.idempotencyKey,
        },
      })

      const updatedAccount = await tx.account.findUnique({
        where: { id: account.id },
      })

      // H1: balanceAfter 取重新读取的真实余额，balanceBefore = balanceAfter + amount（冻结扣减前）
      const balanceAfter = updatedAccount!.availableBalance
      const balanceBefore = balanceAfter + amount

      await tx.accountLedger.create({
        data: {
          accountId: account.id,
          transactionId: order.id,
          type: LedgerType.WITHDRAW,
          amount,
          balanceBefore,
          balanceAfter,
          direction: Direction.CREDIT,
          remark: '提现冻结',
        },
      })

      if (amount > LARGE_WITHDRAWAL_THRESHOLD_CENTS) {
        await tx.riskEvent.create({
          data: {
            userId,
            type: RiskEventType.LARGE_TRANSFER,
            level: RiskLevel.MEDIUM,
            description: `大额提现 ${fenToYuan(amount)} 元`,
          },
        })
      }

      // 提现申请创建成功后记录风控频率（不阻塞业务）
      this.riskEngine.recordTransaction({
        userId,
        type: 'WITHDRAW',
        amount,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(WITHDRAW) 失败: ${err?.message || err}`)
      })

      return order
    })
    })
  }

  async findByUser(userId: string) {
    const orders = await this.prisma.withdrawalOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    // channelAccount 入库时已加密，展示时解密并脱敏，避免明文银行卡号外泄
    return orders.map((order) => {
      if (!order.channelAccount) return order
      try {
        return {
          ...order,
          channelAccount: this.cryptoService.mask(this.cryptoService.decrypt(order.channelAccount)),
        }
      } catch {
        // 解密失败（历史明文数据或密钥变更）时返回脱敏原值，不影响列表展示
        return { ...order, channelAccount: this.cryptoService.mask(order.channelAccount) }
      }
    })
  }

  async approve(orderId: string, adminId: string) {
    // 使用 Redis 锁防止并发审核（同一订单同时被两个管理员审核）
    return this.redis.withLock(`withdraw:approve:${orderId}`, REDIS_LOCK_TTL_SECONDS, async () => {
      const order = await this.prisma.withdrawalOrder.findUnique({
        where: { id: orderId },
      })
      if (!order) throw new NotFoundException(kbError(KBErrorCodes.WITHDRAWAL_ORDER_NOT_FOUND))
      if (order.status !== WithdrawalStatus.PENDING) {
        throw new BadRequestException(kbError(KBErrorCodes.WITHDRAWAL_ORDER_STATUS_INVALID))
      }

      // 获取代付渠道
      const channelEntry = await this.channelRegistry.getChannelByType('PAYOUT')
      if (!channelEntry) {
        throw new BadRequestException(kbError(KBErrorCodes.NO_PAYOUT_CHANNEL))
      }
      const { channel, config, code } = channelEntry

      // 获取用户实名信息
      const user = await this.prisma.user.findUnique({
        where: { id: order.userId },
        include: { identity: true },
      })
      if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))

      // 事务1：原子地将订单状态从 PENDING 改为 PROCESSING，并扣减冻结余额和总余额。
      // 资金先于外部渠道调用出账，确保即使外部调用后崩溃，资金状态也是一致的，
      // 不会出现“代付已发出但冻结余额未扣减”的资金损失。
      const locked = await this.prisma.$transaction(async (tx) => {
        const lockResult = await tx.withdrawalOrder.updateMany({
          where: { id: orderId, status: WithdrawalStatus.PENDING },
          data: { status: WithdrawalStatus.PROCESSING, reviewedBy: adminId, reviewedAt: new Date() },
        })
        if (lockResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.ORDER_ALREADY_HANDLED))
        }

        const account = await tx.account.findUnique({
          where: { userId: order.userId },
        })
        if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

        // 使用 updateMany 加 frozenBalance 条件，防止冻结余额不足时变负
        const updateResult = await tx.account.updateMany({
          where: {
            id: account.id,
            frozenBalance: { gte: order.amount },
          },
          data: {
            frozenBalance: { decrement: order.amount },
            totalBalance: { decrement: order.amount },
          },
        })
        if (updateResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.FROZEN_BALANCE_INSUFFICIENT))
        }

        const updatedAccount = await tx.account.findUnique({
          where: { id: account.id },
        })

        // H1: balanceAfter 取重新读取的真实冻结余额，balanceBefore = balanceAfter + order.amount（扣减前）
        const frozenBalanceAfter = updatedAccount!.frozenBalance
        const frozenBalanceBefore = frozenBalanceAfter + order.amount

        await tx.accountLedger.create({
          data: {
            accountId: account.id,
            transactionId: order.id,
            type: LedgerType.WITHDRAW,
            amount: order.amount,
            balanceBefore: frozenBalanceBefore,
            balanceAfter: frozenBalanceAfter,
            direction: Direction.CREDIT,
            remark: `提现代付中，手续费 ${fenToYuan(order.fee)} 元`,
          },
        })

        // C1: 复式记账移至 handlePayoutCallback 成功路径，
        // 避免代付失败时 PlatformAccount 账本不平（资金实际未离开平台）

        return { account }
      })

      // 调用渠道发起代付（在资金扣减后调用）
      // channelAccount 入库时已加密，传给渠道前需解密还原真实银行卡号
      let channelAccount = ''
      if (order.channelAccount) {
        try {
          channelAccount = this.cryptoService.decrypt(order.channelAccount)
        } catch {
          // 解密失败时回退使用原值（兼容历史明文数据）
          channelAccount = order.channelAccount
        }
      }
      let payoutResult
      try {
        payoutResult = await channel.createPayout({
          orderNo: order.orderNo,
          amount: order.actualAmount,
          channelAccount,
          userName: user.identity?.realName || user.nickname,
          channelConfig: config,
        })
      } catch (error) {
        // 渠道调用超时/网络异常不等于代付未发生：若渠道实际已放款而平台自动退款，
        // 用户将双得、平台亏钱。此处保留 PROCESSING 状态，仅记录异常原因，
        // 由 withdrawals.schedule.ts 的超时扫描器（10 分钟后）调用 queryPayout 核对渠道真实状态，
        // 再由人工通过回调或调账流程处理，确保资金不因误判而双记。
        const failureReason = `代付渠道调用异常：${error instanceof Error ? error.message : '未知错误'}`
        await this.prisma.withdrawalOrder.updateMany({
          where: { id: orderId, status: WithdrawalStatus.PROCESSING },
          data: { remark: failureReason },
        })
        this.logger.warn(
          `提现订单 ${order.orderNo} 渠道调用异常，保持 PROCESSING 等待超时扫描器核对：${failureReason}`,
        )
        throw new BadRequestException(
          kbError(KBErrorCodes.PAYOUT_CHANNEL_FAILED, `${failureReason}，订单保持处理中，等待系统核对渠道真实状态`),
        )
      }

      // 代付成功：保存渠道订单号（回调到达前先持久化，避免回调因 channelOrderNo 为空被拒）
      const updated = await this.prisma.withdrawalOrder.update({
        where: { id: orderId },
        data: {
          channel: code,
          channelOrderNo: payoutResult.channelOrderNo,
        },
      })
      // 代付放款成功后记录风控频率（不阻塞业务）
      this.riskEngine.recordTransaction({
        userId: order.userId,
        type: 'WITHDRAW',
        amount: order.amount,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(WITHDRAW approve) 失败: ${err?.message || err}`)
      })
      return updated
    })
  }

  /**
   * 处理代付回调
   *
   * 成功：生成账单
   * 失败：退回冻结余额到可用余额
   */
  async handlePayoutCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const channel = this.channelRegistry.getChannel(channelCode)
    const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    const result = channel.parsePayoutCallback(rawBody, headers, channelConfig.config)

    return this.redis.withLock(`payout:callback:${result.orderNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      return this.prisma.$transaction(async (tx) => {
        const order = await tx.withdrawalOrder.findUnique({
          where: { orderNo: result.orderNo },
        })
        if (!order) throw new NotFoundException(kbError(KBErrorCodes.WITHDRAWAL_ORDER_NOT_FOUND))
        // 幂等：已成功或已拒绝的不再处理
        if (
          order.status === WithdrawalStatus.SUCCESS ||
          order.status === WithdrawalStatus.FAILED ||
          order.status === WithdrawalStatus.REJECTED
        ) {
          return channel.buildPayoutCallbackSuccess()
        }
        // 安全防护：仅处理 PROCESSING 状态的订单
        // PENDING 订单尚未发起代付，回调不应处理（防止造钱）
        if (order.status !== WithdrawalStatus.PROCESSING) {
          throw new BadRequestException(
            kbError(KBErrorCodes.CALLBACK_STATUS_INVALID, `订单状态 ${order.status} 不支持回调处理`),
          )
        }
        // 安全防护：回调渠道必须与发起代付的渠道一致，防止用 A 渠道密钥伪造对 B 渠道订单的回调
        if (order.channel !== channelCode) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_MISMATCH))
        }
        if (order.channelOrderNo !== result.channelOrderNo) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_ORDER_NO_MISMATCH))
        }

        const account = await tx.account.findUnique({
          where: { userId: order.userId },
        })
        if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

        if (result.status === 'SUCCESS') {
          await tx.withdrawalOrder.update({
            where: { id: order.id },
            data: { status: WithdrawalStatus.SUCCESS },
          })

          await tx.bill.create({
            data: {
              userId: order.userId,
              transactionId: order.id,
              type: BillType.WITHDRAW,
              direction: BillDirection.EXPENSE,
              amount: order.amount,
              remark: '余额提现',
            },
          })

          // C1: 代付成功后才创建复式记账分录，确保 PlatformAccount 与实际资金流向一致
          // 借用户=amount，贷渠道资金=actualAmount，贷手续费收入=fee
          const journalId = generateOrderNo('J')
          await this.journalService.createEntries(tx, [
            { journalId, accountCode: `USER:${order.userId}`, debit: order.amount, memo: `提现 ${order.orderNo}` },
            { journalId, accountCode: 'CHANNEL_FUND', credit: order.actualAmount, memo: `渠道代付 ${order.orderNo}` },
            { journalId, accountCode: 'REVENUE_FEE', credit: order.fee, memo: `手续费收入 ${order.orderNo}` },
          ])
        } else {
          // 失败：先做原子状态转移 PROCESSING -> FAILED，仅获胜方退款，防止并发重复退回。
          // 状态守卫必须先于退款执行：approve 的渠道失败退款路径使用相同的 status:PROCESSING 守卫，
          // 二者通过 updateMany 互斥，仅一方 count===1 并退款，避免余额双记。
          const statusUpdate = await tx.withdrawalOrder.updateMany({
            where: { id: order.id, status: WithdrawalStatus.PROCESSING },
            data: {
              status: WithdrawalStatus.FAILED,
              remark: '代付失败，余额退回',
            },
          })
          if (statusUpdate.count === 0) {
            // 已被其他回调/approve 失败路径处理，幂等返回
            return channel.buildPayoutCallbackSuccess()
          }

          // 退回：approve 阶段已扣减 frozenBalance 和 totalBalance，
          // 失败时退回到 availableBalance 和 totalBalance，使资金回到可用余额。
          const updatedAccount = await tx.account.update({
            where: { id: account.id },
            data: {
              availableBalance: { increment: order.amount },
              totalBalance: { increment: order.amount },
            },
          })

          // H1: balanceAfter 取 update 返回的真实余额，balanceBefore = balanceAfter - amount（加款前）
          const refundBalanceAfter = updatedAccount.availableBalance
          const refundBalanceBefore = refundBalanceAfter - order.amount

          await tx.accountLedger.create({
            data: {
              accountId: account.id,
              transactionId: order.id,
              type: LedgerType.WITHDRAW,
              amount: order.amount,
              balanceBefore: refundBalanceBefore,
              balanceAfter: refundBalanceAfter,
              direction: Direction.DEBIT,
              remark: '代付失败退回',
            },
          })

          await tx.bill.create({
            data: {
              userId: order.userId,
              transactionId: order.id,
              type: BillType.WITHDRAW,
              direction: BillDirection.INCOME,
              amount: order.amount,
              remark: '代付失败退回',
            },
          })
        }

        return channel.buildPayoutCallbackSuccess()
      })
    })
  }

  async reject(orderId: string, adminId: string, reason?: string) {
    return this.redis.withLock(`withdraw:reject:${orderId}`, REDIS_LOCK_TTL_SECONDS, async () => {
      return this.prisma.$transaction(async (tx) => {
        // 原子锁定订单：仅当状态为 PENDING 时才能改为 REJECTED，防止并发双退
        const lockResult = await tx.withdrawalOrder.updateMany({
          where: { id: orderId, status: WithdrawalStatus.PENDING },
          data: {
            status: WithdrawalStatus.REJECTED,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            remark: reason,
          },
        })
        if (lockResult.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.ORDER_ALREADY_HANDLED))
        }

        const order = await tx.withdrawalOrder.findUnique({
          where: { id: orderId },
        })
        if (!order) throw new NotFoundException(kbError(KBErrorCodes.WITHDRAWAL_ORDER_NOT_FOUND))

        const account = await tx.account.findUnique({
          where: { userId: order.userId },
        })
        if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

        // 原子退回冻结余额：仅当冻结余额充足时才执行，防止冻结余额变负
        const updatedAccount = await tx.account.updateMany({
          where: {
            id: account.id,
            frozenBalance: { gte: order.amount },
          },
          data: {
            availableBalance: { increment: order.amount },
            frozenBalance: { decrement: order.amount },
          },
        })
        if (updatedAccount.count === 0) {
          throw new BadRequestException(kbError(KBErrorCodes.FROZEN_BALANCE_INSUFFICIENT))
        }

        // updateMany 不返回更新后的记录，需重新查询以获取最新余额
        const finalAccount = await tx.account.findUnique({
          where: { id: account.id },
        })

        // H1: balanceAfter 取重新读取的真实余额，balanceBefore = balanceAfter - amount（加款前）
        const rejectBalanceAfter = finalAccount!.availableBalance
        const rejectBalanceBefore = rejectBalanceAfter - order.amount

        await tx.accountLedger.create({
          data: {
            accountId: account.id,
            transactionId: order.id,
            type: LedgerType.WITHDRAW,
            amount: order.amount,
            balanceBefore: rejectBalanceBefore,
            balanceAfter: rejectBalanceAfter,
            direction: Direction.DEBIT,
            remark: `提现失败退回：${reason || '审核拒绝'}`,
          },
        })

        await tx.bill.create({
          data: {
            userId: order.userId,
            transactionId: order.id,
            type: BillType.WITHDRAW,
            direction: BillDirection.INCOME,
            amount: order.amount,
            remark: `提现失败退回：${reason || '审核拒绝'}`,
          },
        })

        return order
      })
    })
  }

}
