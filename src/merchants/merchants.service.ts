import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../crypto/crypto.service'
import { Merchant, PaymentOrder, Prisma } from '@prisma/client'
import {
  MerchantStatus,
  MerchantType,
  PaymentOrderStatus,
  QrCodeStatus,
  QrCodeType,
  RealNameStatus,
} from '../common/enums'
import {
  fenToYuan,
  generateAppId,
  generateAppSecret,
  generateMerchantNo,
  generateQrCode,
  yuanToFen,
} from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  DASHBOARD_MONTH_DAYS,
  DASHBOARD_WEEK_DAYS,
  DAY_MS,
  DEFAULT_MERCHANT_DAILY_LIMIT_CENTS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  RATE_DENOMINATOR,
} from '../common/constants'

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async register(
    userId: string,
    dto: {
      merchantName: string
      merchantType?: MerchantType
      contactName?: string
      contactPhone?: string
      settleAccount?: string
      businessLicenseNo?: string
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (user.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }

    const existing = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (existing) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_ALREADY_APPLIED))
    }

    const merchant = await this.prisma.merchant.create({
      data: {
        userId,
        merchantNo: generateMerchantNo(),
        merchantName: dto.merchantName,
        merchantType: dto.merchantType || MerchantType.PERSONAL,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        settleAccount: dto.settleAccount
          ? this.cryptoService.encrypt(dto.settleAccount)
          : dto.settleAccount,
        businessLicenseNo: dto.businessLicenseNo,
        status: MerchantStatus.PENDING,
        payRate: 60,
        withdrawRate: 60,
        dailyLimit: DEFAULT_MERCHANT_DAILY_LIMIT_CENTS,
      },
    })

    return this.formatMerchant(merchant)
  }

  async getMyMerchant(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    return this.formatMerchant(merchant)
  }

  async updateMyMerchant(
    userId: string,
    dto: {
      merchantName?: string
      contactName?: string
      contactPhone?: string
      settleAccount?: string
      businessLicenseNo?: string
    },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    if (
      merchant.status !== MerchantStatus.PENDING &&
      merchant.status !== MerchantStatus.REJECTED
    ) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_NOT_MODIFIABLE))
    }

    const updated = await this.prisma.merchant.update({
      where: { userId },
      data: {
        merchantName: dto.merchantName,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        settleAccount: dto.settleAccount
          ? this.cryptoService.encrypt(dto.settleAccount)
          : dto.settleAccount,
        businessLicenseNo: dto.businessLicenseNo,
      },
    })

    return this.formatMerchant(updated)
  }

  async listMerchants(query: { status?: MerchantStatus; page?: number; limit?: number }) {
    const where: Prisma.MerchantWhereInput = {}
    if (query.status) {
      where.status = query.status
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.merchant.count({ where }),
    ])

    return {
      data: data.map((m) => this.formatMerchant(m)),
      total,
      page,
      limit,
    }
  }

  async auditMerchant(
    id: string,
    dto: { status: MerchantStatus; rejectReason?: string },
    adminId: string,
  ) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    if (merchant.status !== MerchantStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_AUDIT_PENDING_ONLY))
    }

    if (dto.status === MerchantStatus.REJECTED && !dto.rejectReason) {
      throw new BadRequestException(kbError(KBErrorCodes.REJECT_REASON_REQUIRED))
    }

    // H3: 使用 updateMany + status:PENDING 原子守卫，防止 findUnique 检查与更新之间状态被并发改变（TOCTOU）
    const lockResult = await this.prisma.merchant.updateMany({
      where: { id, status: MerchantStatus.PENDING },
      data: {
        status: dto.status,
        rejectReason:
          dto.status === MerchantStatus.REJECTED ? (dto.rejectReason ?? null) : null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    })
    if (lockResult.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_AUDIT_PENDING_ONLY))
    }

    // updateMany 不返回更新后的记录，用原记录 + 新字段构造返回值
    const updated: Merchant = {
      ...merchant,
      status: dto.status,
      rejectReason:
        dto.status === MerchantStatus.REJECTED ? (dto.rejectReason ?? null) : null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
    }

    return this.formatMerchant(updated)
  }

  // 后台调整商户收款费率、提现费率、日限额
  async updateMerchantConfig(
    id: string,
    dto: {
      payRate?: number
      withdrawRate?: number
      dailyLimit?: number
    },
  )
  {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const data: Prisma.MerchantUpdateInput = {}
    if (dto.payRate !== undefined) {
      if (dto.payRate < 0 || dto.payRate > RATE_DENOMINATOR) {
        throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_PAY_RATE_INVALID))
      }
      data.payRate = dto.payRate
    }
    if (dto.withdrawRate !== undefined) {
      if (dto.withdrawRate < 0 || dto.withdrawRate > RATE_DENOMINATOR) {
        throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_WITHDRAW_RATE_INVALID))
      }
      data.withdrawRate = dto.withdrawRate
    }
    if (dto.dailyLimit !== undefined) {
      const limit = yuanToFen(dto.dailyLimit)
      if (limit <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_DAILY_LIMIT_INVALID))
      }
      data.dailyLimit = limit
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_CONFIG_NO_CHANGE))
    }

    const updated = await this.prisma.merchant.update({
      where: { id },
      data,
    })

    return this.formatMerchant(updated)
  }

  async createApp(
    userId: string,
    dto: { name: string; callbackUrl?: string },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    const appId = generateAppId()
    const appSecret = generateAppSecret()
    // 仅存 SHA-256 哈希，明文一次性返回给商户后不再保存
    const appSecretHash = createHash('sha256').update(appSecret).digest('hex')

    const app = await this.prisma.merchantApp.create({
      data: {
        merchantId: merchant.id,
        appId,
        appSecret: appSecretHash,
        name: dto.name,
        callbackUrl: dto.callbackUrl,
      },
    })

    return {
      ...app,
      appSecret,
    }
  }

  async listApps(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))

    const apps = await this.prisma.merchantApp.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    })

    // 列表不返回明文 appSecret，仅返回脱敏值
    return apps.map((app) => ({
      ...app,
      appSecret: this.maskSecret(app.appSecret),
    }))
  }

  // 脱敏：前 4 位 + 中间星号 + 后 4 位
  private maskSecret(secret: string): string {
    if (!secret) return ''
    if (secret.length <= 8) return '****'
    return `${secret.slice(0, 4)}****${secret.slice(-4)}`
  }

  async regenerateSecret(userId: string, appId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))

    const app = await this.prisma.merchantApp.findFirst({
      where: { appId, merchantId: merchant.id },
    })
    if (!app) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_APP_NOT_FOUND))

    const newSecret = generateAppSecret()
    // 仅存 SHA-256 哈希，明文一次性返回
    const newSecretHash = createHash('sha256').update(newSecret).digest('hex')
    const updated = await this.prisma.merchantApp.update({
      where: { id: app.id },
      data: { appSecret: newSecretHash },
    })

    return {
      ...updated,
      appSecret: newSecret,
    }
  }

  // 商户生成固定金额收款码
  async createQrCode(
    userId: string,
    dto: { amount: number; remark?: string },
  )
  {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER))
    }
    const amount = yuanToFen(dto.amount)

    const qrCode = await this.prisma.qrCode.create({
      data: {
        code: generateQrCode(),
        userId,
        merchantId: merchant.id,
        type: QrCodeType.MERCHANT,
        amount,
        remark: dto.remark,
        status: QrCodeStatus.ACTIVE,
      },
    })

    return {
      ...qrCode,
      amountYuan: fenToYuan(qrCode.amount!),
    }
  }

  // 商户的收款码列表
  async listMyQrCodes(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))

    const qrCodes = await this.prisma.qrCode.findMany({
      where: { merchantId: merchant.id, type: QrCodeType.MERCHANT },
      orderBy: { createdAt: 'desc' },
    })

    return qrCodes.map((q) => ({
      ...q,
      amountYuan: q.amount ? fenToYuan(q.amount) : null,
    }))
  }

  // 删除商户收款码（软删除：置为 DISABLED）
  async deleteQrCode(userId: string, qrCodeId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))

    const qrCode = await this.prisma.qrCode.findUnique({
      where: { id: qrCodeId },
    })
    if (!qrCode) throw new NotFoundException(kbError(KBErrorCodes.QR_CODE_NOT_FOUND))
    if (qrCode.merchantId !== merchant.id) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该收款码'))
    }

    return this.prisma.qrCode.update({
      where: { id: qrCodeId },
      data: { status: QrCodeStatus.DISABLED },
    })
  }

  // 商户交易看板：统计今日/近7日/近30日已支付订单
  async getDashboard(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    const now = new Date()
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    )
    const weekStart = new Date(now.getTime() - DASHBOARD_WEEK_DAYS * DAY_MS)
    const monthStart = new Date(now.getTime() - DASHBOARD_MONTH_DAYS * DAY_MS)

    const where = {
      merchantId: merchant.id,
      status: PaymentOrderStatus.PAID,
    }

    const [today, week, month] = await Promise.all([
      this.aggregateStats({ ...where, paidAt: { gte: todayStart } }),
      this.aggregateStats({ ...where, paidAt: { gte: weekStart } }),
      this.aggregateStats({ ...where, paidAt: { gte: monthStart } }),
    ])

    return {
      today: this.formatStats(today),
      week: this.formatStats(week),
      month: this.formatStats(month),
    }
  }

  // 聚合统计某段时间内的订单笔数、总金额、总手续费
  private async aggregateStats(where: Prisma.PaymentOrderWhereInput) {
    const rows = await this.prisma.paymentOrder.aggregate({
      where,
      _count: { id: true },
      _sum: { amount: true, fee: true },
    })
    return {
      count: rows._count.id,
      amount: rows._sum.amount || 0,
      fee: rows._sum.fee || 0,
    }
  }

  private formatStats(stats: { count: number; amount: number; fee: number }) {
    return {
      count: stats.count,
      amountYuan: fenToYuan(stats.amount),
      feeYuan: fenToYuan(stats.fee),
      netYuan: fenToYuan(stats.amount - stats.fee),
    }
  }

  private formatMerchant(merchant: Merchant) {
    return {
      ...merchant,
      settleAccount: this.maskSettleAccount(merchant.settleAccount),
      dailyLimitYuan: fenToYuan(merchant.dailyLimit),
    }
  }

  // 结算账户解密后脱敏（前 4 后 4）；兼容历史明文数据，解密失败时直接脱敏
  private maskSettleAccount(settleAccount: string | null): string | null {
    if (!settleAccount) return null
    try {
      const plain = this.cryptoService.decrypt(settleAccount)
      return this.cryptoService.mask(plain)
    } catch {
      return this.cryptoService.mask(settleAccount)
    }
  }
}
