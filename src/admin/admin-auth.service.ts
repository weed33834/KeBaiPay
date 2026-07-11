import { Injectable, UnauthorizedException, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { AdminRole } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { BCRYPT_SALT_ROUNDS, JWT_TOKEN_TYPE_ADMIN } from '../common/constants'

// 管理员登录失败锁定策略：连续 5 次失败锁定 15 分钟
const ADMIN_LOGIN_MAX_FAILS = 5
const ADMIN_LOGIN_LOCK_TTL_SECONDS = 15 * 60

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name)
  // Redis 未配置时的进程内失败计数降级：username -> { count, expiresAt }
  private readonly memoryFailCache = new Map<string, { count: number; expiresAt: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async seedAdmin() {
    const count = await this.prisma.adminUser.count()
    if (count === 0) {
      const password = process.env.ADMIN_DEFAULT_PASSWORD
      if (!password) {
        throw new Error(
          '未设置 ADMIN_DEFAULT_PASSWORD 环境变量，无法初始化管理员账户',
        )
      }
      await this.prisma.adminUser.create({
        data: {
          username: 'admin',
          password: await bcrypt.hash(password, BCRYPT_SALT_ROUNDS),
          role: AdminRole.SUPER_ADMIN,
        },
      })
      this.logger.log('已使用环境变量 ADMIN_DEFAULT_PASSWORD 初始化管理员账户')
    }
  }

  async login(username: string, password: string, ip?: string, userAgent?: string) {
    const lockKey = `admin:login:fail:${username}`

    // 锁定检查：失败次数达到上限直接拒绝，避免账号被暴力破解。
    // 注意：账号不存在与密码错误都计入失败计数，避免通过响应差异枚举账号。
    const failCount = await this.getFailCount(lockKey)
    if (failCount >= ADMIN_LOGIN_MAX_FAILS) {
      this.logger.warn(`管理员登录被锁定: ${username}`)
      await this.prisma.loginLog.create({
        data: { userId: null, ip, userAgent, success: false, reason: 'ADMIN:账号已锁定' },
      })
      throw new UnauthorizedException(
        kbError(KBErrorCodes.INVALID_CREDENTIALS, '登录失败次数过多，请 15 分钟后再试'),
      )
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { username },
    })
    if (!admin) {
      await this.recordFailure(lockKey)
      await this.prisma.loginLog.create({
        data: { userId: null, ip, userAgent, success: false, reason: 'ADMIN:账号不存在' },
      })
      throw new UnauthorizedException(kbError(KBErrorCodes.INVALID_CREDENTIALS))
    }
    const ok = await bcrypt.compare(password, admin.password)
    if (!ok) {
      await this.recordFailure(lockKey)
      await this.prisma.loginLog.create({
        data: { userId: null, ip, userAgent, success: false, reason: 'ADMIN:密码错误' },
      })
      throw new UnauthorizedException(kbError(KBErrorCodes.INVALID_CREDENTIALS))
    }

    // 登录成功：清除失败计数
    await this.clearFailCount(lockKey)
    await this.prisma.loginLog.create({
      data: { userId: null, ip, userAgent, success: true, reason: 'ADMIN' },
    })
    const token = this.jwtService.sign({ sub: admin.id, role: admin.role, typ: JWT_TOKEN_TYPE_ADMIN })
    return { adminId: admin.id, token }
  }

  private async getFailCount(key: string): Promise<number> {
    if (this.redis.isEnabled()) {
      const v = await this.redis.get(key)
      return v ? Number(v) : 0
    }
    const entry = this.memoryFailCache.get(key)
    if (!entry) return 0
    if (entry.expiresAt < Date.now()) {
      this.memoryFailCache.delete(key)
      return 0
    }
    return entry.count
  }

  private async recordFailure(key: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.incr(key, ADMIN_LOGIN_LOCK_TTL_SECONDS)
      return
    }
    const now = Date.now()
    const entry = this.memoryFailCache.get(key)
    if (!entry || entry.expiresAt < now) {
      this.memoryFailCache.set(key, {
        count: 1,
        expiresAt: now + ADMIN_LOGIN_LOCK_TTL_SECONDS * 1000,
      })
    } else {
      entry.count += 1
    }
  }

  private async clearFailCount(key: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.del(key)
      return
    }
    this.memoryFailCache.delete(key)
  }
}
