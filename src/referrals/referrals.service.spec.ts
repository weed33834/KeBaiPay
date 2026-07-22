import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ReferralsService } from './referrals.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import {
  ReferralStatus,
  RealNameStatus,
  UserStatus,
  AccountStatus,
  TransactionType,
  TransactionStatus,
} from '../common/enums'

describe('ReferralsService', () => {
  let service: ReferralsService
  let prisma: any
  let usersService: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      referralCode: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      referral: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { rewardAmount: 0 } }),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      transactionOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      accountLedger: {
        create: jest.fn(),
      },
      bill: {
        create: jest.fn(),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') return cb(prisma)
        const results = []
        for (const op of cb) results.push(await op)
        return results
      }),
    }

    usersService = {
      findById: jest.fn(),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(ReferralsService)
  })

  // ============== getOrCreateMyCode ==============
  describe('getOrCreateMyCode', () => {
    it('已存在则直接返回', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc1',
        code: 'ABCD1234',
        userId: 'u1',
      })
      const result = await service.getOrCreateMyCode('u1')
      expect(result?.code).toBe('ABCD1234')
      expect(prisma.referralCode.create).not.toHaveBeenCalled()
    })

    it('不存在则创建新邀请码', async () => {
      prisma.referralCode.findUnique.mockResolvedValueOnce(null)
      prisma.referralCode.findUnique // 第二次检查（在锁内）
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null) // generateUniqueCode 检查唯一
      prisma.referralCode.create.mockResolvedValue({
        id: 'rc1',
        code: 'TESTCODE',
        userId: 'u1',
      })
      const result = await service.getOrCreateMyCode('u1')
      expect(result?.code).toBe('TESTCODE')
      expect(prisma.referralCode.create).toHaveBeenCalled()
    })

    it('并发时被其他线程创建则返回已有', async () => {
      prisma.referralCode.findUnique
        .mockResolvedValueOnce(null) // 初次
        .mockResolvedValueOnce({ id: 'rc2', code: 'EXISTING', userId: 'u1' }) // 锁内再次
      const result = await service.getOrCreateMyCode('u1')
      expect(result?.code).toBe('EXISTING')
      expect(prisma.referralCode.create).not.toHaveBeenCalled()
    })
  })

  // ============== findMyCode ==============
  describe('findMyCode', () => {
    it('存在则返回', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc1',
        code: 'ABCD',
        userId: 'u1',
      })
      const result = await service.findMyCode('u1')
      expect(result?.code).toBe('ABCD')
    })

    it('不存在返回 null', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null)
      const result = await service.findMyCode('u1')
      expect(result).toBeNull()
    })
  })

  // ============== bindInvitee ==============
  describe('bindInvitee', () => {
    it('邀请码不存在应抛 404', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null)
      await expect(
        service.bindInvitee('u2', { code: 'NOTEXIST' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('不能邀请自己', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc1',
        code: 'SELF',
        userId: 'u1',
      })
      await expect(
        service.bindInvitee('u1', { code: 'SELF' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('已绑定过应抛错', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc1',
        code: 'CODE1',
        userId: 'u1',
      })
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        inviteeId: 'u2',
        referrerId: 'u1',
      })
      await expect(
        service.bindInvitee('u2', { code: 'CODE1' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功绑定邀请关系', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'rc1',
        code: 'CODE1',
        userId: 'u1',
      })
      prisma.referral.findUnique.mockResolvedValue(null)
      prisma.referral.create.mockResolvedValue({
        id: 'r1',
        referralNo: 'REF1',
        referrerId: 'u1',
        inviteeId: 'u2',
        status: ReferralStatus.PENDING,
      })
      const result = await service.bindInvitee('u2', { code: 'CODE1' })
      expect(result?.status).toBe(ReferralStatus.PENDING)
      expect(prisma.referral.create).toHaveBeenCalled()
    })
  })

  // ============== listMyReferrals ==============
  describe('listMyReferrals', () => {
    it('应返回分页列表', async () => {
      prisma.referral.findMany.mockResolvedValue([
        { id: 'r1', referrerId: 'u1', inviteeId: 'u2' },
      ])
      prisma.referral.count.mockResolvedValue(1)
      const result = await service.listMyReferrals('u1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
    })

    it('status 过滤生效', async () => {
      prisma.referral.findMany.mockResolvedValue([])
      prisma.referral.count.mockResolvedValue(0)
      await service.listMyReferrals('u1', { status: 'COMPLETED' })
      expect(prisma.referral.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { referrerId: 'u1', status: 'COMPLETED' },
        }),
      )
    })
  })

  // ============== getStats ==============
  describe('getStats', () => {
    it('应返回正确统计数据', async () => {
      prisma.referral.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(5) // completed
        .mockResolvedValueOnce(2) // cancelled
      prisma.referral.aggregate.mockResolvedValue({ _sum: { rewardAmount: 5000 } })
      const result = await service.getStats('u1')
      expect(result.total).toBe(10)
      expect(result.pending).toBe(3)
      expect(result.completed).toBe(5)
      expect(result.cancelled).toBe(2)
      expect(result.totalRewardAmount).toBe(5000)
    })

    it('无奖励时返回 0', async () => {
      prisma.referral.count.mockResolvedValue(0)
      prisma.referral.aggregate.mockResolvedValue({ _sum: { rewardAmount: null } })
      const result = await service.getStats('u1')
      expect(result.totalRewardAmount).toBe(0)
    })
  })

  // ============== findByReferralNo ==============
  describe('findByReferralNo', () => {
    it('存在则返回', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        referralNo: 'REF1',
        referrerId: 'u1',
      })
      const result = await service.findByReferralNo('REF1')
      expect(result?.referralNo).toBe('REF1')
    })

    it('不存在应抛 404', async () => {
      prisma.referral.findUnique.mockResolvedValue(null)
      await expect(service.findByReferralNo('NOTEXIST')).rejects.toThrow(NotFoundException)
    })
  })

  // ============== cancel ==============
  describe('cancel', () => {
    it('不存在应抛 404', async () => {
      prisma.referral.findUnique.mockResolvedValue(null)
      await expect(
        service.cancel('u1', 'REF1', { reason: '违规' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('非邀请人应抛 Forbidden', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        referralNo: 'REF1',
        referrerId: 'u-other',
        status: ReferralStatus.PENDING,
      })
      await expect(
        service.cancel('u1', 'REF1', { reason: '违规' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('非 PENDING 状态应抛错', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        referralNo: 'REF1',
        referrerId: 'u1',
        status: ReferralStatus.COMPLETED,
      })
      await expect(
        service.cancel('u1', 'REF1', { reason: '违规' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功取消', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        id: 'r1',
        referralNo: 'REF1',
        referrerId: 'u1',
        status: ReferralStatus.PENDING,
      })
      prisma.referral.update.mockResolvedValue({
        id: 'r1',
        status: ReferralStatus.CANCELLED,
        cancelReason: '违规',
      })
      const result = await service.cancel('u1', 'REF1', { reason: '违规' })
      expect(result?.status).toBe(ReferralStatus.CANCELLED)
    })
  })

  // ============== triggerReward ==============
  describe('triggerReward', () => {
    const mockReferral = {
      id: 'r1',
      referralNo: 'REF1',
      referrerId: 'u1',
      inviteeId: 'u2',
      status: ReferralStatus.PENDING,
      rewardAmount: 0,
    }
    const mockOrder = {
      id: 't1',
      orderNo: 'TX1',
      type: TransactionType.RECHARGE,
      status: TransactionStatus.SUCCESS,
      amount: 10000, // 100 元
      fromUserId: 'u2',
    }
    const mockReferrerAccount = {
      id: 'a1',
      userId: 'u1',
      status: AccountStatus.ACTIVE,
      availableBalance: 5000,
    }
    const mockReferrer = {
      id: 'u1',
      realNameStatus: RealNameStatus.VERIFIED,
      status: UserStatus.ACTIVE,
    }

    it('邀请关系不存在应抛 404', async () => {
      prisma.referral.findUnique.mockResolvedValue(null)
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('邀请非 PENDING 状态应抛错', async () => {
      prisma.referral.findUnique.mockResolvedValue({
        ...mockReferral,
        status: ReferralStatus.COMPLETED,
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('触发交易不存在应抛错', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(null)
      await expect(
        service.triggerReward('u2', { transactionNo: 'NOTEXIST' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('触发交易未成功应抛错', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue({
        ...mockOrder,
        status: TransactionStatus.PENDING,
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('触发交易类型不支持应抛错', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue({
        ...mockOrder,
        type: 'WITHDRAW', // 不在支持列表中
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('触发交易不属于被邀请人应抛 Forbidden', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue({
        ...mockOrder,
        fromUserId: 'u-other',
        toUserId: 'u-other',
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('触发交易金额低于门槛应抛错', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue({
        ...mockOrder,
        amount: 50, // 0.5 元，低于 1 元门槛
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('邀请人账户不存在应抛 404', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(mockOrder)
      prisma.account.findUnique.mockResolvedValue(null)
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('邀请人账户状态异常应抛 Forbidden', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(mockOrder)
      prisma.account.findUnique.mockResolvedValue({
        ...mockReferrerAccount,
        status: AccountStatus.FROZEN,
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('邀请人未实名应抛 Forbidden', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(mockOrder)
      prisma.account.findUnique.mockResolvedValue(mockReferrerAccount)
      prisma.user.findUnique.mockResolvedValue({
        ...mockReferrer,
        realNameStatus: RealNameStatus.UNVERIFIED,
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('邀请人账户被冻结应抛 Forbidden', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(mockOrder)
      prisma.account.findUnique.mockResolvedValue(mockReferrerAccount)
      prisma.user.findUnique.mockResolvedValue({
        ...mockReferrer,
        status: UserStatus.FROZEN,
      })
      await expect(
        service.triggerReward('u2', { transactionNo: 'TX1' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('成功发放奖励', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(mockOrder)
      prisma.account.findUnique.mockResolvedValue(mockReferrerAccount)
      prisma.user.findUnique.mockResolvedValue(mockReferrer)
      prisma.systemConfig.findUnique.mockResolvedValue(null) // 用默认配置
      prisma.account.update.mockResolvedValue({
        ...mockReferrerAccount,
        availableBalance: 5500,
      })
      prisma.transactionOrder.create.mockResolvedValue({
        id: 't2',
        orderNo: 'RWD1',
      })
      prisma.referral.update.mockResolvedValue({
        ...mockReferral,
        status: ReferralStatus.COMPLETED,
        rewardAmount: 1000,
        triggerTxNo: 'TX1',
      })
      const result = await service.triggerReward('u2', { transactionNo: 'TX1' })
      expect(result?.status).toBe(ReferralStatus.COMPLETED)
      expect(result?.rewardAmount).toBe(1000)
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            availableBalance: { increment: 1000 },
          }),
        }),
      )
    })

    it('使用 system_config 自定义奖励金额', async () => {
      prisma.referral.findUnique.mockResolvedValue(mockReferral)
      prisma.transactionOrder.findFirst.mockResolvedValue(mockOrder)
      prisma.account.findUnique.mockResolvedValue(mockReferrerAccount)
      prisma.user.findUnique.mockResolvedValue(mockReferrer)
      prisma.systemConfig.findUnique.mockResolvedValue({ value: '20' }) // 20 元
      prisma.account.update.mockResolvedValue({
        ...mockReferrerAccount,
        availableBalance: 7000,
      })
      prisma.transactionOrder.create.mockResolvedValue({ id: 't2', orderNo: 'RWD1' })
      prisma.referral.update.mockResolvedValue({
        ...mockReferral,
        status: ReferralStatus.COMPLETED,
        rewardAmount: 2000,
      })
      const result = await service.triggerReward('u2', { transactionNo: 'TX1' })
      expect(result?.rewardAmount).toBe(2000)
    })
  })

  // ============== findCodeByCode ==============
  describe('findCodeByCode', () => {
    it('应转大写后查询', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({ id: 'rc1', code: 'ABCD1234' })
      await service.findCodeByCode('abcd1234')
      expect(prisma.referralCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'ABCD1234' },
      })
    })
  })
})
