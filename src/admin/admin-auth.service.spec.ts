import { UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { AdminRole } from '../common/enums'
import { AdminAuthService } from './admin-auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { JwtService } from '@nestjs/jwt'

type PrismaMock = {
  adminUser: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock }
  loginLog: { create: jest.Mock }
}
type RedisMock = {
  isEnabled: jest.Mock
  get: jest.Mock
  incr: jest.Mock
  del: jest.Mock
}

describe('AdminAuthService', () => {
  let service: AdminAuthService
  let prisma: PrismaMock
  let redis: RedisMock
  let jwtService: { sign: jest.Mock }

  // 低成本 bcrypt 哈希，仅用于测试比对
  const hashedPassword = bcrypt.hashSync('correct-pwd', 4)

  beforeEach(() => {
    prisma = {
      adminUser: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
      loginLog: { create: jest.fn().mockResolvedValue(undefined) },
    }
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      get: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(undefined),
    }
    jwtService = { sign: jest.fn().mockReturnValue('jwt-token') }

    service = new AdminAuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      redis as unknown as RedisService,
    )
  })

  const adminUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'admin1',
    username: 'admin',
    password: hashedPassword,
    role: AdminRole.SUPER_ADMIN,
    ...overrides,
  })

  describe('login', () => {
    it('成功登录：写成功日志、清除失败计数、返回 token', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminUser())

      const result = await service.login('admin', 'correct-pwd', '1.2.3.4', 'ua')

      expect(result).toEqual({ adminId: 'admin1', token: 'jwt-token' })
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'admin1',
        role: AdminRole.SUPER_ADMIN,
        typ: 'admin',
      })
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            success: true,
            reason: 'ADMIN',
            ip: '1.2.3.4',
            userAgent: 'ua',
          }),
        }),
      )
    })

    it('账号不存在：写失败日志、自增失败计数、抛错', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null)

      await expect(service.login('admin', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      )

      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            success: false,
            reason: 'ADMIN:账号不存在',
          }),
        }),
      )
    })

    it('密码错误：写失败日志、抛错', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminUser())

      await expect(service.login('admin', 'wrong-pwd')).rejects.toThrow(
        UnauthorizedException,
      )

      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            success: false,
            reason: 'ADMIN:密码错误',
          }),
        }),
      )
    })

    it('连续失败 5 次后锁定，第 6 次直接拒绝且不再查询账号', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminUser())

      // 前 5 次密码错误（每次都走完整校验流程）
      for (let i = 0; i < 5; i++) {
        await expect(service.login('admin', 'wrong-pwd')).rejects.toThrow(
          UnauthorizedException,
        )
      }

      // 第 6 次应被锁定，且不再查询 adminUser
      prisma.adminUser.findUnique.mockClear()
      await expect(service.login('admin', 'wrong-pwd')).rejects.toThrow(
        UnauthorizedException,
      )
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled()
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            success: false,
            reason: 'ADMIN:账号已锁定',
          }),
        }),
      )
    })

    it('登录成功后失败计数被清零', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminUser())

      // 累计 4 次失败（未达锁定阈值）
      for (let i = 0; i < 4; i++) {
        await expect(service.login('admin', 'wrong-pwd')).rejects.toThrow(
          UnauthorizedException,
        )
      }
      // 成功登录应清零计数
      await service.login('admin', 'correct-pwd')

      // 再失败 4 次仍不应锁定（每次都查 admin）；若计数未清零，第二次就会触发锁定
      for (let i = 0; i < 4; i++) {
        prisma.adminUser.findUnique.mockClear()
        await expect(service.login('admin', 'wrong-pwd')).rejects.toThrow(
          UnauthorizedException,
        )
        expect(prisma.adminUser.findUnique).toHaveBeenCalled()
      }
    })

    it('Redis 可用时：失败调用 incr（带 TTL），成功调用 del 清零', async () => {
      redis.isEnabled.mockReturnValue(true)
      redis.get.mockResolvedValue(null)
      prisma.adminUser.findUnique.mockResolvedValue(adminUser())

      await expect(service.login('admin', 'wrong-pwd')).rejects.toThrow(
        UnauthorizedException,
      )
      expect(redis.incr).toHaveBeenCalledWith(
        'admin:login:fail:admin',
        expect.any(Number),
      )

      await service.login('admin', 'correct-pwd')
      expect(redis.del).toHaveBeenCalledWith('admin:login:fail:admin')
    })

    it('Redis 可用时：失败计数达到阈值触发锁定', async () => {
      redis.isEnabled.mockReturnValue(true)
      redis.get.mockResolvedValue('5') // 已失败 5 次
      prisma.adminUser.findUnique.mockResolvedValue(adminUser())

      await expect(service.login('admin', 'correct-pwd')).rejects.toThrow(
        UnauthorizedException,
      )
      // 锁定后不应查询账号、不应校验密码
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled()
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            success: false,
            reason: 'ADMIN:账号已锁定',
          }),
        }),
      )
    })
  })
})
