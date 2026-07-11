import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { createHmac } from 'crypto'
import { PaymentOrder, Prisma } from '@prisma/client'
import {
  PaymentOrderStatus,
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  MerchantStatus,
  QrCodeStatus,
  QrCodeType,
  RealNameStatus,
  NotifyStatus,
  AccountStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { JournalService } from '../finance/journal.service'
import { RedisService } from '../redis/redis.service'
import { fenToYuan, generateOrderNo, generatePaymentNo, isCallbackUrlSafe, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  CALLBACK_TIMEOUT_MS,
  DASHBOARD_MONTH_DAYS,
  DASHBOARD_WEEK_DAYS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PAYMENT_DAILY_LIMIT_CENTS,
  MAX_CALLBACK_RETRIES,
  MAX_EXPORT_ROWS,
  MAX_PAGE_SIZE,
  ORDER_EXPIRY_MS,
  RATE_DENOMINATOR,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'

@Injectable()
export class CashierService {
  private readonly logger = new Logger(CashierService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly journalService: JournalService,
    private readonly redis: RedisService,
  ) {}

  async createOrder(
    userId: string,
    dto: {
      merchantOrderNo: string
      amount: number
      subject: string
      body?: string
      callbackUrl?: string
      expiredAt?: Date
    },
  )
  {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER))
    }
    const amount = yuanToFen(dto.amount)

    const existing = await this.prisma.paymentOrder.findFirst({
      where: {
        merchantId: merchant.id,
        merchantOrderNo: dto.merchantOrderNo,
      },
    })
    if (existing) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_ORDER_NO_EXISTS))
    }

    if (dto.callbackUrl) {
      await this.validateCallbackUrl(dto.callbackUrl)
    }

    const expiredAt =
      dto.expiredAt || new Date(Date.now() + ORDER_EXPIRY_MS)
    if (expiredAt <= new Date()) {
      throw new BadRequestException(kbError(KBErrorCodes.EXPIRED_TIME_INVALID))
    }
    const orderNo = generatePaymentNo()

    try {
      const order = await this.prisma.paymentOrder.create({
        data: {
          merchantId: merchant.id,
          merchantOrderNo: dto.merchantOrderNo,
          orderNo,
          amount,
          subject: dto.subject,
          body: dto.body,
          callbackUrl: dto.callbackUrl,
          expiredAt,
        },
      })

      return this.formatOrder(order)
    } catch (e) {
      // 并发场景下唯一约束冲突：两个请求同时通过上方的存在性检查时，
      // 第二个 create 会触发 P2002，查回原单幂等返回，避免商户并发重试拿不到已创建订单
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
        if (existed) return this.formatOrder(existed)
        throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_ORDER_NO_EXISTS))
      }
      throw e
    }
  }

  async getOrder(orderNo: string, userId?: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
      include: {
        merchant: { select: { merchantNo: true, merchantName: true } },
      },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    // 收银台公开查询仅返回支付所需的最少信息，不暴露 merchantNo 等商户敏感字段
    return {
      orderNo: order.orderNo,
      merchantName: order.merchant?.merchantName || '-',
      subject: order.subject,
      amountYuan: fenToYuan(order.amount),
      status: order.status,
      expiredAt: order.expiredAt,
    }
  }

  async pay(
    payerId: string,
    dto: { orderNo: string; payPassword: string; idempotencyKey?: string },
  ) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo: dto.orderNo },
      include: { merchant: true },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))

    // 幂等返回：订单已支付且付款方一致时直接返回，避免网络超时重试时
    // 第二次请求命中 status≠PENDING 抛 ORDER_STATUS_CHANGED，用户不知道其实已支付成功
    if (
      order.status === PaymentOrderStatus.PAID &&
      order.payerId === payerId
    ) {
      return this.formatOrder(order)
    }

    // 重新校验商户状态：订单创建后商户可能被管理员关闭/拒绝，此时不应继续支付
    if (order.merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_CANNOT_RECEIVE))
    }

    const payer = await this.usersService.findById(payerId)
    if (!payer) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND, '付款用户不存在'))
    if (payer.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (payer.status === 'FROZEN' || payer.status === 'EXPENSE_RESTRICTED') {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户当前禁止支出'))
    }
    await this.usersService.verifyPayPassword(payerId, dto.payPassword)

    const merchantUser = await this.usersService.findById(
      order.merchant.userId,
    )
    if (!merchantUser) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_USER_NOT_FOUND))

    // 风控检查：在事务前执行，拦截高风险交易
    const riskResult = await this.riskEngine.check({
      userId: payerId,
      type: 'PAYMENT',
      amount: order.amount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `支付被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
        ),
      )
    }

    const amount = order.amount
    const fee = Math.round((amount * order.merchant.payRate) / RATE_DENOMINATOR)
    const actualAmount = amount - fee
    const dateStr = new Date().toISOString().slice(0, 10)

    const paidOrder = await this.redis.withLock(
      `cashier:pay:${dto.orderNo}:${payerId}`,
      10,
      async () => this.prisma.$transaction(async (tx) => {
      const payerAccount = await tx.account.findUnique({
        where: { userId: payerId },
      })
      const merchantAccount = await tx.account.findUnique({
        where: { userId: order.merchant.userId },
      })
      if (!payerAccount || !merchantAccount) {
        throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
      }
      if (payerAccount.status !== AccountStatus.ACTIVE) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '付款方账户状态异常'))
      }
      if (merchantAccount.status !== AccountStatus.ACTIVE) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '收款方账户状态异常'))
      }

      // 商户日限额校验：当日已支付订单金额累计 + 本次 ≤ merchant.dailyLimit
      await this.checkMerchantDailyLimit(tx, order.merchant.id, order.merchant.dailyLimit, amount)

      const config = await tx.systemConfig.findUnique({
        where: { key: 'payment_daily_limit' },
      })
      const limit = config ? Math.round(Number(config.value) * 100) : DEFAULT_PAYMENT_DAILY_LIMIT_CENTS
      // 付款方单日限额校验（原子递增）
      await this.usersService.checkAndIncrementDailyLimit(
        tx,
        payerId,
        'CASHIER',
        dateStr,
        amount,
        limit,
      )

      // 幂等校验 + 订单状态原子确认/锁定
      const orderUpdate = await tx.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: PaymentOrderStatus.PENDING,
          expiredAt: { gt: new Date() },
        },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt: new Date(),
          payerId,
          fee,
        },
      })
      if (orderUpdate.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.ORDER_STATUS_CHANGED))
      }

      // 付款方原子扣款
      const payerDeduction = await tx.account.updateMany({
        where: {
          id: payerAccount.id,
          availableBalance: { gte: amount },
        },
        data: {
          availableBalance: { decrement: amount },
          totalBalance: { decrement: amount },
        },
      })
      if (payerDeduction.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
      }

      const txOrder = await tx.transactionOrder.create({
        data: {
          orderNo: generateOrderNo('PAY'),
          type: TransactionType.PAYMENT,
          status: TransactionStatus.SUCCESS,
          amount,
          fee,
          fromUserId: payerId,
          toUserId: order.merchant.userId,
          relatedOrderNo: order.orderNo,
          completedAt: new Date(),
        },
      })

      const updatedMerchantAccount = await tx.account.update({
        where: { id: merchantAccount.id },
        data: {
          availableBalance: { increment: actualAmount },
          totalBalance: { increment: actualAmount },
        },
      })

      // H1: updateMany 不返回更新后的记录，重新读取真实余额，保证账本 balanceBefore/After 准确
      const updatedPayerAccount = await tx.account.findUnique({
        where: { id: payerAccount.id },
      })

      await tx.accountLedger.create({
        data: {
          accountId: payerAccount.id,
          transactionId: txOrder.id,
          type: LedgerType.PAYMENT,
          amount,
          // H1: balanceBefore = balanceAfter + amount（扣款前）
          balanceBefore: updatedPayerAccount!.availableBalance + amount,
          balanceAfter: updatedPayerAccount!.availableBalance,
          direction: Direction.CREDIT,
          remark: `支付订单 ${order.orderNo}`,
        },
      })

      await tx.accountLedger.create({
        data: {
          accountId: merchantAccount.id,
          transactionId: txOrder.id,
          type: LedgerType.PAYMENT,
          amount: actualAmount,
          // H1: balanceAfter 取 update 返回的真实余额，balanceBefore = balanceAfter - actualAmount（加款前）
          balanceBefore: updatedMerchantAccount.availableBalance - actualAmount,
          balanceAfter: updatedMerchantAccount.availableBalance,
          direction: Direction.DEBIT,
          remark: `收款订单 ${order.orderNo}，手续费 ${fenToYuan(
            fee,
          )} 元`,
        },
      })

      await tx.bill.create({
        data: {
          userId: payerId,
          transactionId: txOrder.id,
          type: BillType.PAYMENT,
          direction: BillDirection.EXPENSE,
          amount,
          counterparty: merchantUser.nickname,
          remark: `支付订单 ${order.orderNo}`,
        },
      })

      await tx.bill.create({
        data: {
          userId: order.merchant.userId,
          transactionId: txOrder.id,
          type: BillType.RECEIPT,
          direction: BillDirection.INCOME,
          amount: actualAmount,
          counterparty: payer.nickname,
          remark: `收款订单 ${order.orderNo}，手续费 ${fenToYuan(
            fee,
          )} 元`,
        },
      })

      // 复式记账：借付款方=amount，贷商户=actualAmount，贷手续费收入=fee
      const journalId = generateOrderNo('J')
      await this.journalService.createEntries(tx, [
        { journalId, accountCode: `USER:${payerId}`, debit: amount, memo: `支付订单 ${order.orderNo}` },
        { journalId, accountCode: `USER:${order.merchant.userId}`, credit: actualAmount, memo: `收款订单 ${order.orderNo}` },
        { journalId, accountCode: 'REVENUE_FEE', credit: fee, memo: `手续费收入 ${order.orderNo}` },
      ])

      return {
        ...order,
        status: PaymentOrderStatus.PAID,
        paidAt: new Date(),
        payerId,
        fee,
      }
      }),
    )

    // 事务提交后异步通知商户，不阻塞支付返回，失败不影响用户
    if (paidOrder.callbackUrl) {
      setImmediate(() => {
        this.notifyMerchant(paidOrder).catch((err) => {
          this.logger.error(
            `订单 ${paidOrder.orderNo} 回调通知异常: ${err?.message || err}`,
          )
        })
      })
    }

    return this.formatOrder(paidOrder)
  }

  // 批量关闭过期未支付订单
  async closeExpiredOrders() {
    const now = new Date()
    const result = await this.prisma.paymentOrder.updateMany({
      where: {
        status: PaymentOrderStatus.PENDING,
        expiredAt: { lt: now },
      },
      data: {
        status: PaymentOrderStatus.CLOSED,
      },
    })
    this.logger.log(`已关闭 ${result.count} 条过期订单`)
  }

  // 商户回调通知：POST callbackUrl，带 X-KB-Signature 签名头，最多重试 5 次
  async notifyMerchant(order: {
    id: string
    orderNo: string
    merchantOrderNo: string
    amount: number
    status: PaymentOrderStatus
    paidAt: Date | null
    callbackUrl: string | null
    appId: string | null
  }) {
    if (!order.callbackUrl) {
      return { notifyStatus: NotifyStatus.PENDING, notifyCount: 0 }
    }

    // 在闭包外捕获 callbackUrl，避免 TS 在闭包内无法窄化对象属性类型
    const callbackUrl = order.callbackUrl

    // H4: 同一订单的回调通知加分布式锁，防止支付后异步通知与商户手动重试并发执行，
    // 导致重复回调商户 / notifyStatus 与 notifyCount 互相覆盖。锁内重新读取订单状态，
    // 已通知成功的直接幂等返回，避免重复发货。
    return this.redis.withLock(
      `cashier:notify:${order.id}`,
      REDIS_LOCK_TTL_SECONDS,
      async () => {
        // 锁内重新读取订单，已通知成功则幂等返回，避免重复通知商户
        const latest = await this.prisma.paymentOrder.findUnique({
          where: { id: order.id },
          select: { notifyStatus: true, notifyCount: true, callbackUrl: true },
        })
        if (latest?.notifyStatus === NotifyStatus.SUCCESS) {
          return {
            notifyStatus: latest.notifyStatus,
            notifyCount: latest.notifyCount,
          }
        }

        // 通知前再次校验回调地址：订单创建后可能因 DNS rebinding 指向内网，
        // 此时不应发起请求，直接标记通知失败
        const urlCheck = await isCallbackUrlSafe(callbackUrl)
        if (!urlCheck.safe) {
          this.logger.warn(
            `订单 ${order.orderNo} 回调地址不安全: ${urlCheck.reason}`,
          )
          const blocked = await this.prisma.paymentOrder.update({
            where: { id: order.id },
            data: { notifyStatus: NotifyStatus.FAILED, notifyCount: 0 },
          })
          return {
            notifyStatus: blocked.notifyStatus,
            notifyCount: blocked.notifyCount,
          }
        }

        let appSecret = ''
        if (order.appId) {
          const app = await this.prisma.merchantApp.findUnique({
            where: { appId: order.appId },
            select: { appSecret: true },
          })
          appSecret = app?.appSecret || ''
        }

        const payload = {
          orderNo: order.orderNo,
          merchantOrderNo: order.merchantOrderNo,
          amount: order.amount,
          amountYuan: fenToYuan(order.amount),
          status: order.status,
          paidAt: order.paidAt,
        }
        const body = JSON.stringify(payload)
        const signature = createHmac('sha256', appSecret).update(body).digest('hex')

        const maxRetries = MAX_CALLBACK_RETRIES
        let attempts = 0
        let success = false
        for (let i = 0; i < maxRetries; i++) {
          attempts += 1
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS)
          try {
            const resp = await fetch(callbackUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-KB-Signature': signature,
              },
              body,
              signal: controller.signal,
              redirect: 'manual',
            })
            if (resp.ok) {
              success = true
              break
            }
            this.logger.warn(
              `订单 ${order.orderNo} 回调第 ${attempts} 次失败，HTTP ${resp.status}`,
            )
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            this.logger.warn(
              `订单 ${order.orderNo} 回调第 ${attempts} 次异常: ${message}`,
            )
          } finally {
            clearTimeout(timeout)
          }
          // 指数退避：1s, 2s, 4s, 8s, 16s
          if (i < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000))
          }
        }

        const updated = await this.prisma.paymentOrder.update({
          where: { id: order.id },
          data: {
            notifyStatus: success ? NotifyStatus.SUCCESS : NotifyStatus.FAILED,
            notifyCount: attempts,
          },
        })

        return {
          notifyStatus: updated.notifyStatus,
          notifyCount: updated.notifyCount,
        }
      },
    )
  }

  // 手动重试回调通知（商户自身触发）
  async retryNotify(userId: string, orderNo: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    if (order.merchantId !== merchant.id) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订单'))
    }
    if (!order.callbackUrl) {
      throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_URL_NOT_SET))
    }
    // 已通知成功的订单不再重复通知，避免给商户重复发货的入口
    if (order.notifyStatus === NotifyStatus.SUCCESS) {
      throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_ALREADY_SUCCESS))
    }

    return this.notifyMerchant({ ...order, status: order.status as PaymentOrderStatus })
  }

  // 商户日限额：使用 DailyLimitUsage 原子递增，防止高并发突破限额
  private async checkMerchantDailyLimit(
    tx: Prisma.TransactionClient,
    merchantId: string,
    dailyLimit: number,
    amount: number,
  ) {
    const dateStr = new Date().toISOString().slice(0, 10)

    let usage = await tx.dailyLimitUsage.findFirst({
      where: {
        userId: merchantId,
        limitType: 'MERCHANT_PAYMENT',
        date: dateStr,
      },
    })
    if (!usage) {
      usage = await tx.dailyLimitUsage.create({
        data: {
          userId: merchantId,
          limitType: 'MERCHANT_PAYMENT',
          date: dateStr,
          usedAmount: 0,
          version: 0,
        },
      })
    }

    const updated = await tx.dailyLimitUsage.updateMany({
      where: {
        id: usage.id,
        version: usage.version,
        usedAmount: { lte: dailyLimit - amount },
      },
      data: {
        usedAmount: { increment: amount },
        version: { increment: 1 },
      },
    })

    if (updated.count === 0) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `超出商户日限额，限额 ${fenToYuan(dailyLimit)} 元`,
        ),
      )
    }
  }

  async listMyOrders(
    userId: string,
    query: {
      status?: PaymentOrderStatus
      startDate?: string
      endDate?: string
      page?: number
      limit?: number
    },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))
    const where: Prisma.PaymentOrderWhereInput = { merchantId: merchant.id }
    if (query.status) {
      where.status = query.status
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59`)
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentOrder.count({ where }),
    ])

    return {
      data: data.map((o) => this.formatOrder(o)),
      total,
      page,
      limit,
    }
  }

  // 商户对账导出，生成 Excel 兼容的 CSV 字符串
  async exportMyOrders(
    userId: string,
    query: {
      startDate?: string
      endDate?: string
      status?: PaymentOrderStatus
    },
  )
  : Promise<string> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const where: Prisma.PaymentOrderWhereInput = { merchantId: merchant.id }
    if (query.status) {
      where.status = query.status
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59`)
      }
    }

    // 不分页，但限制最多 MAX_EXPORT_ROWS 条防止滥用
    const orders = await this.prisma.paymentOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT_ROWS,
    })

    const statusMap: Record<string, string> = {
      PENDING: '待支付',
      PAID: '已支付',
      CLOSED: '已关闭',
      EXPIRED: '已过期',
      REFUNDED: '已退款',
    }

    const header =
      '订单号,商户订单号,金额(元),手续费(元),实收(元),状态,创建时间,支付时间'
    const lines = orders.map((o) => {
      const actualAmount = o.amount - (o.fee || 0)
      return [
        o.orderNo,
        o.merchantOrderNo,
        fenToYuan(o.amount),
        fenToYuan(o.fee || 0),
        fenToYuan(actualAmount),
        statusMap[o.status] || o.status,
        this.formatDateTime(o.createdAt),
        o.paidAt ? this.formatDateTime(o.paidAt) : '',
      ]
        .map((v) => this.escapeCsvField(String(v)))
        .join(',')
    })

    // UTF-8 BOM 让 Excel 正确识别中文
    return '\uFEFF' + header + '\n' + lines.join('\n')
  }

  // 商户对账汇总，按日统计已支付订单
  async reconciliation(
    userId: string,
    query: { startDate?: string; endDate?: string },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const where: Prisma.PaymentOrderWhereInput = {
      merchantId: merchant.id,
      status: PaymentOrderStatus.PAID,
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59`)
      }
    }

    const orders = await this.prisma.paymentOrder.findMany({
      where,
      select: { amount: true, fee: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // 按日分组统计
    const dailyMap = new Map<
      string,
      { count: number; amount: number; fee: number }
    >()
    for (const order of orders) {
      const date = this.formatDate(order.createdAt)
      const entry = dailyMap.get(date) || { count: 0, amount: 0, fee: 0 }
      entry.count += 1
      entry.amount += order.amount
      entry.fee += order.fee || 0
      dailyMap.set(date, entry)
    }

    const data = Array.from(dailyMap.entries()).map(([date, v]) => ({
      date,
      count: v.count,
      amountYuan: fenToYuan(v.amount),
      feeYuan: fenToYuan(v.fee),
      netYuan: fenToYuan(v.amount - v.fee),
    }))

    const totalAmount = orders.reduce((s, o) => s + o.amount, 0)
    const totalFee = orders.reduce((s, o) => s + (o.fee || 0), 0)
    const summary = {
      count: orders.length,
      amountYuan: fenToYuan(totalAmount),
      feeYuan: fenToYuan(totalFee),
      netYuan: fenToYuan(totalAmount - totalFee),
    }

    return { data, summary }
  }

  // 根据商户收款码查商户信息，供收银台展示
  async getQrCodeOrderInfo(code: string) {
    const qrCode = await this.prisma.qrCode.findUnique({
      where: { code },
      include: { merchant: true },
    })
    if (!qrCode) throw new NotFoundException(kbError(KBErrorCodes.QR_CODE_NOT_FOUND))
    if (qrCode.type !== QrCodeType.MERCHANT) {
      throw new BadRequestException(kbError(KBErrorCodes.QR_CODE_NOT_MERCHANT))
    }
    if (qrCode.status !== QrCodeStatus.ACTIVE) {
      throw new BadRequestException(kbError(KBErrorCodes.QR_CODE_EXPIRED))
    }
    if (!qrCode.merchant) {
      throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    }
    if (qrCode.merchant.status !== MerchantStatus.APPROVED) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_STATUS_ABNORMAL))
    }

    const merchant = qrCode.merchant
    const remark = qrCode.remark || ''
    return {
      merchantNo: merchant.merchantNo,
      merchantName: merchant.merchantName,
      amountYuan: qrCode.amount ? fenToYuan(qrCode.amount) : null,
      remark,
      subject: remark || `向${merchant.merchantName}付款`,
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

  private formatOrder(order: PaymentOrder) {
    return {
      ...order,
      amountYuan: fenToYuan(order.amount),
      feeYuan: fenToYuan(order.fee),
    }
  }

  // CSV 字段转义：含逗号、引号或换行时用双引号包裹，内部引号转义为两个引号
  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  // 格式化为 YYYY-MM-DD HH:mm:ss
  private formatDateTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds(),
    )}`
  }

  // 格式化为 YYYY-MM-DD
  private formatDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}`
  }
}
