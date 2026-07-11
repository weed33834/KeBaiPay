import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { UsersService } from '../users/users.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { BCRYPT_SALT_ROUNDS, JWT_TOKEN_TYPE_USER } from '../common/constants'

// 用户登录失败锁定策略：连续 5 次失败锁定 15 分钟
const LOGIN_MAX_FAILS = 5
const LOGIN_LOCK_TTL_SECONDS = 15 * 60

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  // Redis 未配置时的进程内失败计数降级：identifier -> { count, expiresAt }
  private readonly memoryFailCache = new Map<string, { count: number; expiresAt: number }>()

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async register(dto: { nickname: string; phone?: string; email?: string; password: string }) {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(kbError(KBErrorCodes.MISSING_PHONE_OR_EMAIL))
    }
    const user = await this.usersService.create({
      nickname: dto.nickname,
      phone: dto.phone,
      email: dto.email,
      loginPassword: await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS),
    })
    return { userId: user.id, token: this.signToken(user.id) }
  }

  async login(
    dto: { phone?: string; email?: string; password: string },
    ip?: string,
    userAgent?: string,
  ) {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException(kbError(KBErrorCodes.MISSING_PHONE_OR_EMAIL))
    }
    const identifier = dto.phone || dto.email!
    const lockKey = `login:fail:${identifier}`

    // 锁定检查：失败次数达到上限直接拒绝，避免账号被暴力破解。
    // 注意：账号不存在与密码错误都计入失败计数，避免通过响应差异枚举账号。
    const failCount = await this.getFailCount(lockKey)
    if (failCount >= LOGIN_MAX_FAILS) {
      this.logger.warn(`用户登录被锁定: ${identifier}`)
      await this.prisma.loginLog.create({
        data: {
          userId: null,
          ip,
          userAgent,
          success: false,
          reason: '账号已被锁定',
        },
      })
      throw new UnauthorizedException(
        kbError(KBErrorCodes.INVALID_CREDENTIALS, '账号已被锁定，请15分钟后重试'),
      )
    }

    const user = await this.usersService.findByCredential(dto.phone, dto.email)
    if (!user) {
      await this.recordFailure(lockKey)
      await this.prisma.loginLog.create({
        data: {
          userId: null,
          ip,
          userAgent,
          success: false,
          reason: '账号或密码错误',
        },
      })
      throw new UnauthorizedException(kbError(KBErrorCodes.INVALID_CREDENTIALS))
    }
    const ok = await bcrypt.compare(dto.password, user.loginPassword)
    if (!ok) {
      await this.recordFailure(lockKey)
      await this.prisma.loginLog.create({
        data: {
          userId: user.id,
          ip,
          userAgent,
          success: false,
          reason: '密码错误',
        },
      })
      throw new UnauthorizedException(kbError(KBErrorCodes.INVALID_CREDENTIALS))
    }

    // 登录成功：清除失败计数
    await this.clearFailCount(lockKey)
    await this.prisma.loginLog.create({
      data: {
        userId: user.id,
        ip,
        userAgent,
        success: true,
      },
    })
    return { userId: user.id, token: this.signToken(user.id) }
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
      await this.redis.incr(key, LOGIN_LOCK_TTL_SECONDS)
      return
    }
    const now = Date.now()
    const entry = this.memoryFailCache.get(key)
    if (!entry || entry.expiresAt < now) {
      this.memoryFailCache.set(key, {
        count: 1,
        expiresAt: now + LOGIN_LOCK_TTL_SECONDS * 1000,
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

  private signToken(userId: string) {
    return this.jwtService.sign({ sub: userId, typ: JWT_TOKEN_TYPE_USER })
  }
}
