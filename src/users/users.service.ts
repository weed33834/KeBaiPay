import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { CryptoService } from '../crypto/crypto.service'
import { SmsService } from '../sms/sms.service'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { RealNameStatus } from '../common/enums'
import { fenToYuan } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  BCRYPT_SALT_ROUNDS,
  DEFAULT_TRANSFER_DAILY_LIMIT_CENTS,
  MAX_PAY_PASSWORD_ATTEMPTS,
  PAY_PASSWORD_LOCK_MS,
} from '../common/constants'

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly smsService: SmsService,
  ) {}

  // Redis 不可用时降级到进程内缓存；生产环境务必配置 Redis
  private readonly payPasswordAttempts = new Map<
    string,
    { count: number; lockedUntil: number }
  >()
  private readonly maxPayPasswordAttempts = MAX_PAY_PASSWORD_ATTEMPTS
  private readonly payPasswordLockMs = PAY_PASSWORD_LOCK_MS

  private payPasswordKey(userId: string) {
    return `paypwd:attempts:${userId}`
  }

  private async getAttempts(userId: string): Promise<{ count: number; lockedUntil: number }> {
    if (this.redis.isEnabled()) {
      const raw = await this.redis.get(this.payPasswordKey(userId))
      if (raw) {
        try {
          return JSON.parse(raw)
        } catch {
          return { count: 0, lockedUntil: 0 }
        }
      }
    }
    return this.payPasswordAttempts.get(userId) || { count: 0, lockedUntil: 0 }
  }

  private async setAttempts(userId: string, attempts: { count: number; lockedUntil: number }) {
    if (this.redis.isEnabled()) {
      await this.redis.set(
        this.payPasswordKey(userId),
        JSON.stringify(attempts),
        Math.ceil(this.payPasswordLockMs / 1000),
      )
    } else {
      this.payPasswordAttempts.set(userId, attempts)
    }
  }

  async create(data: {
    nickname: string
    phone?: string
    email?: string
    loginPassword: string
  }) {
    return this.prisma.user.create({
      data: {
        ...data,
        account: {
          create: {},
        },
      },
      include: { account: true },
    })
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { account: true, identity: true },
    })
  }

  /**
   * 获取用户资料（脱敏后的安全视图）
   * 身份证号先解密再脱敏，避免对密文截尾产生无意义结果
   */
  async getSafeProfile(id: string) {
    const user = await this.findById(id)
    if (!user) return null
    const { loginPassword, payPassword, ...safe } = user
    if (safe.identity?.idCard) {
      try {
        const decrypted = this.crypto.decrypt(safe.identity.idCard)
        safe.identity = {
          ...safe.identity,
          idCard: this.maskIdCard(decrypted),
        }
      } catch {
        // 解密失败（旧数据或密钥变更），对明文/旧格式脱敏
        safe.identity = {
          ...safe.identity,
          idCard: this.maskIdCard(safe.identity.idCard),
        }
      }
    }
    return safe
  }

  private maskIdCard(idCard: string): string {
    if (!idCard) return ''
    if (idCard.length <= 7) return idCard.replace(/.(?=.{1})/g, '*')
    return idCard.slice(0, 3) + '*'.repeat(idCard.length - 7) + idCard.slice(-4)
  }

  async findByCredential(phone?: string, email?: string) {
    if (phone) {
      return this.prisma.user.findUnique({ where: { phone } })
    }
    if (email) {
      return this.prisma.user.findUnique({ where: { email } })
    }
    return null
  }

  async verifyIdentity(
    userId: string,
    dto: { realName: string; idCard: string; payPassword: string },
  ) {
    const user = await this.findById(userId)
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (user.realNameStatus === RealNameStatus.VERIFIED) {
      throw new BadRequestException(kbError(KBErrorCodes.ALREADY_VERIFIED))
    }
    if (user.realNameStatus === RealNameStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.VERIFICATION_PENDING))
    }

    // 支付密码哈希暂存到 IdentityVerification，审核通过后才写入 user.payPassword。
    // 此前直接写入 user.payPassword 会导致：管理员 reject 后用户仍能用支付密码转账/提现，绕过实名。
    const payPasswordHash = await this.hashPassword(dto.payPassword)

    // 加密身份证号后存储
    const encryptedIdCard = this.crypto.encrypt(dto.idCard)
    // 明文 SHA-256 哈希用于唯一约束：AES-GCM 加密带 IV 每次密文不同，
    // 仅靠 id_card @unique 无法防止同一身份证被多用户提交
    const idCardHash = createHash('sha256').update(dto.idCard).digest('hex')

    // 提交前先校验身份证唯一性：DB 唯一约束兜底，但提前查表能给出更友好的错误码
    const existing = await this.prisma.identityVerification.findFirst({
      where: { idCardHash, userId: { not: userId } },
      select: { id: true },
    })
    if (existing) {
      throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_IDCARD_USED))
    }

    // 提交人工审核：状态置 PENDING，不直接通过
    // payPasswordHash 暂存到 identityVerification，不写入 user 表
    const [identity] = await this.prisma.$transaction([
      this.prisma.identityVerification.upsert({
        where: { userId },
        create: {
          userId,
          realName: dto.realName,
          idCard: encryptedIdCard,
          idCardHash,
          status: RealNameStatus.PENDING,
          pendingPayPasswordHash: payPasswordHash,
        },
        update: {
          realName: dto.realName,
          idCard: encryptedIdCard,
          idCardHash,
          status: RealNameStatus.PENDING,
          pendingPayPasswordHash: payPasswordHash,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          realNameStatus: RealNameStatus.PENDING,
          // 不写 payPassword：审核通过前用户不能使用支付密码
        },
      }),
    ])

    return identity
  }

  async verifyPayPassword(userId: string, payPassword: string) {
    const now = Date.now()
    const record = await this.getAttempts(userId)
    if (record.lockedUntil > now) {
      throw new BadRequestException(
        kbError(
          KBErrorCodes.PAY_PASSWORD_LOCKED,
          `支付密码已锁定，请 ${Math.ceil((record.lockedUntil - now) / 60000)} 分钟后重试`,
        ),
      )
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { payPassword: true },
    })
    if (!user?.payPassword) {
      throw new BadRequestException(kbError(KBErrorCodes.PAY_PASSWORD_NOT_SET))
    }
    const ok = await this.comparePassword(payPassword, user.payPassword)
    if (!ok) {
      const attempts = record.count + 1
      if (attempts >= this.maxPayPasswordAttempts) {
        await this.setAttempts(userId, {
          count: attempts,
          lockedUntil: now + this.payPasswordLockMs,
        })
        throw new BadRequestException(
          kbError(KBErrorCodes.PAY_PASSWORD_LOCKED_OUT),
        )
      }
      await this.setAttempts(userId, {
        count: attempts,
        lockedUntil: 0,
      })
      throw new BadRequestException(kbError(KBErrorCodes.PAY_PASSWORD_INCORRECT))
    }

    // 验证成功清零
    if (this.redis.isEnabled()) {
      await this.redis.del(this.payPasswordKey(userId))
    } else {
      this.payPasswordAttempts.delete(userId)
    }
    return true
  }

  async resetPayPassword(
    userId: string,
    dto: { realName: string; idCard: string; newPayPassword: string },
  ) {
    const identity = await this.prisma.identityVerification.findUnique({
      where: { userId },
    })
    if (!identity) {
      throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_NOT_FOUND))
    }
    // 必须实名已审核通过：reject 后的 identity 记录仍存在，但 status=REJECTED，
    // 不允许重置支付密码，避免未实名用户通过 realName+idCard 绕过审核设置 payPassword
    if (identity.status !== RealNameStatus.VERIFIED) {
      throw new BadRequestException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    // 解密存储的身份证号进行比较
    const decryptedIdCard = this.crypto.decrypt(identity.idCard)
    if (identity.realName !== dto.realName || decryptedIdCard !== dto.idCard) {
      throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_MISMATCH))
    }

    const payPasswordHash = await this.hashPassword(dto.newPayPassword)
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { payPassword: payPasswordHash },
    })

    // 重置密码后清除失败尝试计数器
    if (this.redis.isEnabled()) {
      await this.redis.del(this.payPasswordKey(userId))
    } else {
      this.payPasswordAttempts.delete(userId)
    }

    return result
  }

  private async hashPassword(password: string) {
    const bcrypt = await import('bcrypt')
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS)
  }

  private async comparePassword(password: string, hash: string) {
    const bcrypt = await import('bcrypt')
    return bcrypt.compare(password, hash)
  }

  async getDailyLimit(userId: string) {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'transfer_daily_limit' },
    })
    const limit = config ? Math.round(Number(config.value) * 100) : DEFAULT_TRANSFER_DAILY_LIMIT_CENTS

    const today = new Date().toISOString().slice(0, 10)

    const usage = await this.prisma.dailyLimitUsage.findUnique({
      where: {
        userId_limitType_date: {
          userId,
          limitType: 'TRANSFER',
          date: today,
        },
      },
    })

    const used = usage?.usedAmount || 0
    return {
      limitYuan: fenToYuan(limit),
      usedYuan: fenToYuan(used),
      remainingYuan: fenToYuan(Math.max(0, limit - used)),
    }
  }

  async checkAndIncrementDailyLimit(
    tx: Prisma.TransactionClient,
    userId: string,
    limitType: string,
    date: string,
    amount: number,
    limit: number,
  ): Promise<void> {
    if (amount > limit) {
      throw new BadRequestException(kbError(KBErrorCodes.DAILY_LIMIT_EXCEEDED))
    }

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

    const updated = await tx.dailyLimitUsage.updateMany({
      where: {
        id: usage.id,
        version: usage.version,
        usedAmount: { lte: limit - amount },
      },
      data: {
        usedAmount: { increment: amount },
        version: { increment: 1 },
      },
    })

    if (updated.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.DAILY_LIMIT_EXCEEDED))
    }
  }

  /** 修改登录密码 */
  async changeLoginPassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))

    const bcrypt = await import('bcrypt')
    const ok = await bcrypt.compare(oldPassword, user.loginPassword)
    if (!ok) {
      throw new UnauthorizedException(kbError(KBErrorCodes.LOGIN_PASSWORD_INCORRECT))
    }
    if (oldPassword === newPassword) {
      throw new BadRequestException('新密码不能与原密码相同')
    }
    const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS)
    await this.prisma.user.update({
      where: { id: userId },
      data: { loginPassword: newHash },
    })
    return { success: true }
  }

  /** 更新用户基础资料：昵称、头像、邮箱（仅基础更新，邮箱绑定走 bind-email 走验证码流程） */
  async updateProfile(userId: string, dto: { nickname?: string; avatar?: string; email?: string }) {
    const data: { nickname?: string; avatar?: string; email?: string } = {}
    if (dto.nickname !== undefined) data.nickname = dto.nickname
    if (dto.avatar !== undefined) data.avatar = dto.avatar
    if (dto.email !== undefined) {
      // 改邮箱前先校验是否被其他账号占用
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
      if (existing && existing.id !== userId) {
        throw new BadRequestException(kbError(KBErrorCodes.EMAIL_ALREADY_BOUND))
      }
      data.email = dto.email
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('至少修改一个字段')
    }
    await this.prisma.user.update({ where: { id: userId }, data })
    return this.getSafeProfile(userId)
  }

  /**
   * 绑定/换绑手机号
   * 校验短信验证码（scene=bind）后更新 user.phone；
   * 同一手机号只能被一个账号绑定（@unique 约束保证）
   */
  async bindPhone(userId: string, phone: string, code: string) {
    const verifyResult = await this.smsService.verifyCode(phone, code, 'bind')
    if (!verifyResult.valid) {
      throw new BadRequestException(kbError(KBErrorCodes.SMS_CODE_INVALID))
    }
    // 检查手机号是否已被其他账号占用
    const existing = await this.prisma.user.findUnique({ where: { phone } })
    if (existing && existing.id !== userId) {
      throw new BadRequestException(kbError(KBErrorCodes.PHONE_ALREADY_BOUND))
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { phone },
    })
    return { success: true }
  }

  /**
   * 绑定/换绑邮箱
   * TODO: 项目当前仅有短信通道，邮箱验证码暂通过短信发到用户已绑定的手机号；
   * 后续接入邮件服务时，把这里的校验改为 verifyEmailCode(email, code)
   */
  async bindEmail(userId: string, email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (!user.phone) {
      throw new BadRequestException('请先绑定手机号')
    }
    // 暂时复用短信验证码：邮箱验证码会以短信形式发到用户已绑手机号
    const verifyResult = await this.smsService.verifyCode(user.phone, code, 'bind')
    if (!verifyResult.valid) {
      throw new BadRequestException(kbError(KBErrorCodes.SMS_CODE_INVALID))
    }
    // 检查邮箱是否已被其他账号占用
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing && existing.id !== userId) {
      throw new BadRequestException(kbError(KBErrorCodes.EMAIL_ALREADY_BOUND))
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { email },
    })
    return { success: true }
  }

  /** 查询当前用户的登录日志（最近 30 天，最多 100 条） */
  async getLoginLogs(userId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const logs = await this.prisma.loginLog.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        ip: true,
        userAgent: true,
        success: true,
        reason: true,
        createdAt: true,
      },
    })
    return logs
  }
}
