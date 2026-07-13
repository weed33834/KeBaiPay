import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { CryptoService } from '../crypto/crypto.service'
import { RealNameStatus } from '../common/enums'
import { kbError, KBErrorCodes } from '../common/error-codes'

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (pwd: string) => `hashed_${pwd}`),
  compare: jest.fn(async (pwd: string, hash: string) => hash === `hashed_${pwd}`),
}))

describe('UsersService', () => {
  let service: UsersService

  type PrismaMock = {
    $transaction: jest.Mock
    user: Record<string, jest.Mock>
    account: Record<string, jest.Mock>
    identityVerification: Record<string, jest.Mock>
    systemConfig: Record<string, jest.Mock>
    dailyLimitUsage: Record<string, jest.Mock>
  } & Record<string, unknown>

  let prisma: PrismaMock
  let redis: RedisService

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      account: { create: jest.fn() },
      identityVerification: { upsert: jest.fn(), findUnique: jest.fn() },
      systemConfig: { findUnique: jest.fn() },
      dailyLimitUsage: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (ops: unknown[]) => {
        const results = []
        for (const op of ops) {
          results.push(await op)
        }
        return results
      }),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as RedisService

    const crypto = {
      encrypt: jest.fn((text: string) => `enc_${text}`),
      decrypt: jest.fn((text: string) => text.replace(/^enc_/, '')),
      mask: jest.fn((text: string, h: number, t: number) => {
        if (!text) return ''
        if (text.length <= h + t) return '****'
        return `${text.slice(0, h)}****${text.slice(-t)}`
      }),
    } as unknown as CryptoService

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile()

    service = module.get(UsersService)
  })

  describe('create 创建用户', () => {
    it('同时创建 user 和 account', async () => {
      const data = { nickname: '张三', phone: '13800138000', loginPassword: 'pwd' }
      prisma.user.create.mockResolvedValue({ id: 'u1', ...data, account: { id: 'a1' } })

      const result = await service.create(data)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { ...data, account: { create: {} } },
        include: { account: true },
      })
      expect(result.account).toBeDefined()
    })
  })

  describe('findById 按 ID 查询', () => {
    it('包含 account 和 identity', async () => {
      const user = { id: 'u1', nickname: '张三', account: { id: 'a1' }, identity: null }
      prisma.user.findUnique.mockResolvedValue(user)

      const result = await service.findById('u1')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        include: { account: true, identity: true },
      })
      expect(result).toEqual(user)
    })
  })

  describe('findByCredential 按凭证查询', () => {
    it('按 phone 查询', async () => {
      const user = { id: 'u1', phone: '13800138000' }
      prisma.user.findUnique.mockResolvedValue(user)

      const result = await service.findByCredential('13800138000')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '13800138000' } })
      expect(result).toEqual(user)
    })

    it('按 email 查询', async () => {
      const user = { id: 'u1', email: 'a@b.com' }
      prisma.user.findUnique.mockResolvedValue(user)

      const result = await service.findByCredential(undefined, 'a@b.com')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } })
      expect(result).toEqual(user)
    })

    it('无参数返回 null', async () => {
      const result = await service.findByCredential()
      expect(result).toBeNull()
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('verifyIdentity 实名认证', () => {
    const dto = { realName: '张三', idCard: '110101199001011234', payPassword: '123456' }

    it('用户不存在报错', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      await expect(service.verifyIdentity('u1', dto)).rejects.toThrow(NotFoundException)
    })

    it('已实名用户报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.VERIFIED })
      await expect(service.verifyIdentity('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('审核中用户报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.PENDING })
      await expect(service.verifyIdentity('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('正常用户 upsert identity 并更新状态为 PENDING、设置 payPassword', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.UNVERIFIED })
      prisma.identityVerification.upsert.mockResolvedValue({ id: 'i1', userId: 'u1', status: RealNameStatus.PENDING })
      prisma.user.update.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.PENDING })

      const result = await service.verifyIdentity('u1', dto)

      expect(prisma.identityVerification.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: {
          userId: 'u1',
          realName: dto.realName,
          idCard: `enc_${dto.idCard}`,
          status: RealNameStatus.PENDING,
          // 支付密码哈希暂存到 identityVerification，审核通过后才写入 user.payPassword
          pendingPayPasswordHash: 'hashed_123456',
        },
        update: {
          realName: dto.realName,
          idCard: `enc_${dto.idCard}`,
          status: RealNameStatus.PENDING,
          pendingPayPasswordHash: 'hashed_123456',
        },
      })
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          // 审核通过前 user.payPassword 不写入，避免 reject 后用户仍能用支付密码
          realNameStatus: RealNameStatus.PENDING,
        },
      })
      expect(result.status).toBe(RealNameStatus.PENDING)
    })
  })

  describe('verifyPayPassword 验证支付密码', () => {
    it('未设置密码报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: null })
      await expect(service.verifyPayPassword('u1', '123456')).rejects.toThrow(BadRequestException)
    })

    it('错误密码报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: 'hashed_654321' })
      await expect(service.verifyPayPassword('u1', '123456')).rejects.toThrow(BadRequestException)
    })

    it('错误 5 次后锁定 15 分钟', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: 'hashed_654321' })
      for (let i = 0; i < 4; i++) {
        await expect(service.verifyPayPassword('u1', '123456')).rejects.toThrow('支付密码错误')
      }
      await expect(service.verifyPayPassword('u1', '123456')).rejects.toThrow('支付密码错误次数过多')
      // 第 6 次直接拒绝
      await expect(service.verifyPayPassword('u1', '123456')).rejects.toThrow('支付密码已锁定')
    })

    it('正确密码返回 true 并清零错误次数', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: 'hashed_123456' })
      const result = await service.verifyPayPassword('u1', '123456')
      expect(result).toBe(true)
    })
  })

  describe('resetPayPassword 重置支付密码', () => {
    const dto = { realName: '张三', idCard: '110101199001011234', newPayPassword: '654321' }

    it('未找到实名信息报错', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue(null)
      await expect(service.resetPayPassword('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('实名信息不匹配报错', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        realName: '李四',
        idCard: '110101199001011234',
      })
      await expect(service.resetPayPassword('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('实名信息匹配则更新密码', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        realName: '张三',
        idCard: '110101199001011234',
      })
      prisma.user.update.mockResolvedValue({ id: 'u1', payPassword: 'hashed_654321' })

      await service.resetPayPassword('u1', dto)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { payPassword: 'hashed_654321' },
      })
    })
  })

  describe('getDailyLimit 单日限额', () => {
    it('默认 5 万元，计算今日已用和剩余', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.dailyLimitUsage.findUnique.mockResolvedValue({ usedAmount: 1000000 })

      const result = await service.getDailyLimit('u1')

      expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({ where: { key: 'transfer_daily_limit' } })
      expect(prisma.dailyLimitUsage.findUnique).toHaveBeenCalledWith({
        where: {
          userId_limitType_date: {
            userId: 'u1',
            limitType: 'TRANSFER',
            date: expect.any(String),
          },
        },
      })
      expect(result).toEqual({
        limitYuan: '50000.00',
        usedYuan: '10000.00',
        remainingYuan: '40000.00',
      })
    })

    it('使用系统配置限额', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: '10000' })
      prisma.dailyLimitUsage.findUnique.mockResolvedValue({ usedAmount: 200000 })

      const result = await service.getDailyLimit('u1')

      expect(result).toEqual({
        limitYuan: '10000.00',
        usedYuan: '2000.00',
        remainingYuan: '8000.00',
      })
    })

    it('无记录时今日已用为 0', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.dailyLimitUsage.findUnique.mockResolvedValue(null)

      const result = await service.getDailyLimit('u1')

      expect(result).toEqual({
        limitYuan: '50000.00',
        usedYuan: '0.00',
        remainingYuan: '50000.00',
      })
    })
  })

  describe('checkAndIncrementDailyLimit 原子递增单日限额', () => {
    it('正常递增通过', async () => {
      const tx = {
        dailyLimitUsage: {
          findFirst: jest.fn().mockResolvedValue({ id: 'dlu1', version: 0, usedAmount: 0 }),
          create: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }

      await service.checkAndIncrementDailyLimit(tx as unknown as import('@prisma/client').Prisma.TransactionClient, 'u1', 'TRANSFER', '2026-06-24', 1000, 5000000)

      // 实现已从 upsert 改为 findFirst + create + updateMany（先查不存在则建，再乐观锁更新）
      expect(tx.dailyLimitUsage.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          limitType: 'TRANSFER',
          date: '2026-06-24',
        },
      })
      // 已存在记录，不应再 create
      expect(tx.dailyLimitUsage.create).not.toHaveBeenCalled()
      expect(tx.dailyLimitUsage.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dlu1',
          version: 0,
          usedAmount: { lte: 4999000 },
        },
        data: {
          usedAmount: { increment: 1000 },
          version: { increment: 1 },
        },
      })
    })

    it('超出限额时 updateMany 返回 0 抛错', async () => {
      const tx = {
        dailyLimitUsage: {
          findFirst: jest.fn().mockResolvedValue({ id: 'dlu1', version: 1, usedAmount: 5000000 }),
          create: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }

      await expect(
        service.checkAndIncrementDailyLimit(tx as unknown as import('@prisma/client').Prisma.TransactionClient, 'u1', 'TRANSFER', '2026-06-24', 1000, 5000000),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.checkAndIncrementDailyLimit(tx as unknown as import('@prisma/client').Prisma.TransactionClient, 'u1', 'TRANSFER', '2026-06-24', 1000, 5000000),
      ).rejects.toThrow(kbError(KBErrorCodes.DAILY_LIMIT_EXCEEDED))
    })

    it('单次金额已超过限额直接抛错', async () => {
      const tx = {
        dailyLimitUsage: {
          findFirst: jest.fn(),
          create: jest.fn(),
          updateMany: jest.fn(),
        },
      }

      const txClient = tx as unknown as import('@prisma/client').Prisma.TransactionClient
      await expect(
        service.checkAndIncrementDailyLimit(txClient, 'u1', 'TRANSFER', '2026-06-24', 6000000, 5000000),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.checkAndIncrementDailyLimit(txClient, 'u1', 'TRANSFER', '2026-06-24', 6000000, 5000000),
      ).rejects.toThrow(kbError(KBErrorCodes.DAILY_LIMIT_EXCEEDED))
      // amount > limit 时直接抛错，不查数据库
      expect(tx.dailyLimitUsage.findFirst).not.toHaveBeenCalled()
    })
  })
})
