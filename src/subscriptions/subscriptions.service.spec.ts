import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { SubscriptionsService } from './subscriptions.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import {
  SubscriptionStatus,
  SubscriptionPlanStatus,
  SubscriptionChargeStatus,
  RealNameStatus,
  UserStatus,
  RiskLevel,
  AccountStatus,
} from '../common/enums'
import { KBErrorCodes } from '../common/error-codes'

describe('SubscriptionsService', () => {
  let service: SubscriptionsService
  let prisma: any
  let usersService: any
  let riskEngine: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      subscriptionPlan: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionCharge: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ availableBalance: 100 }),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
      transactionOrder: { create: jest.fn().mockResolvedValue({ id: 'tx1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({ nickname: 'tester' }),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') return cb(prisma)
        const results = []
        for (const op of cb) results.push(await op)
        return results
      }),
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn().mockResolvedValue(true),
      checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(undefined),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ blocked: false, rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(SubscriptionsService)
  })

  // ============== createPlan ==============
  describe('createPlan', () => {
    it('应成功创建订阅计划', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.VERIFIED,
      })
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'plan1', planNo: 'SP1' })

      const result = await service.createPlan('owner1', {
        name: '月度会员',
        amount: 9.9,
        period: 'MONTHLY',
      } as any)

      expect(result.planNo).toBe('SP1')
      expect(prisma.subscriptionPlan.create).toHaveBeenCalled()
    })

    it('金额无效应抛 BadRequest', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.VERIFIED,
      })
      await expect(
        service.createPlan('owner1', {
          name: 'test',
          amount: 0,
          period: 'MONTHLY',
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('未实名应抛 Forbidden', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.UNVERIFIED,
      })
      await expect(
        service.createPlan('owner1', {
          name: 'test',
          amount: 9.9,
          period: 'MONTHLY',
        } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('owner 不存在应抛 NotFound', async () => {
      usersService.findById.mockResolvedValue(null)
      await expect(
        service.createPlan('owner1', {
          name: 'test',
          amount: 9.9,
          period: 'MONTHLY',
        } as any),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ============== findPlanByNo ==============
  describe('findPlanByNo', () => {
    it('应返回计划详情', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'p1', planNo: 'SP1' })
      const result = await service.findPlanByNo('SP1')
      expect(result.id).toBe('p1')
    })

    it('计划不存在应抛 NotFound', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue(null)
      await expect(service.findPlanByNo('NOT_EXIST')).rejects.toThrow(NotFoundException)
    })
  })

  // ============== listPlans ==============
  describe('listPlans', () => {
    it('应返回分页列表', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([{ id: 'p1' }])
      prisma.subscriptionPlan.count.mockResolvedValue(1)
      const result = await service.listPlans('owner1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
    })

    it('应支持 status 过滤', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([])
      prisma.subscriptionPlan.count.mockResolvedValue(0)
      await service.listPlans('owner1', { status: 'ACTIVE' })
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      )
    })
  })

  // ============== setPlanStatus ==============
  describe('setPlanStatus', () => {
    it('应成功启用/禁用', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        id: 'p1',
        ownerId: 'owner1',
        status: 'ACTIVE',
      })
      prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', status: 'DISABLED' })

      const result = await service.setPlanStatus('owner1', 'SP1', 'DISABLED')
      expect(result.status).toBe('DISABLED')
    })

    it('非 owner 应抛 Forbidden', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        id: 'p1',
        ownerId: 'other',
        status: 'ACTIVE',
      })
      await expect(
        service.setPlanStatus('owner1', 'SP1', 'DISABLED'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('计划不存在应抛 NotFound', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue(null)
      await expect(
        service.setPlanStatus('owner1', 'SP1', 'DISABLED'),
      ).rejects.toThrow(NotFoundException)
    })

    it('状态未变化应抛 BadRequest', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        id: 'p1',
        ownerId: 'owner1',
        status: 'ACTIVE',
      })
      await expect(
        service.setPlanStatus('owner1', 'SP1', 'ACTIVE'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== subscribe ==============
  describe('subscribe', () => {
    const plan = {
      id: 'plan1',
      planNo: 'SP1',
      ownerId: 'owner1',
      amount: 1000,
      period: 'MONTHLY',
      intervalCount: 1,
      trialDays: 0,
      totalCycles: null,
      status: SubscriptionPlanStatus.ACTIVE,
    }
    const subscriber = {
      id: 'sub1',
      realNameStatus: RealNameStatus.VERIFIED,
      status: UserStatus.ACTIVE,
      riskLevel: RiskLevel.LOW,
    }
    const owner = {
      id: 'owner1',
      realNameStatus: RealNameStatus.VERIFIED,
      status: UserStatus.ACTIVE,
    }

    beforeEach(() => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue(plan)
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'sub1') return Promise.resolve(subscriber)
        if (id === 'owner1') return Promise.resolve(owner)
        return Promise.resolve(null)
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc1',
        userId: 'sub1',
        availableBalance: 10000,
        status: AccountStatus.ACTIVE,
      })
      prisma.subscription.create.mockResolvedValue({ id: 'sub_record', subscriptionNo: 'SUB1' })
      prisma.subscription.update.mockResolvedValue({ id: 'sub_record', status: 'ACTIVE' })
      prisma.subscriptionCharge.create.mockResolvedValue({ id: 'charge1' })
      prisma.subscriptionCharge.update.mockResolvedValue({ id: 'charge1', status: 'SUCCESS' })
      prisma.account.update.mockResolvedValue({ availableBalance: 9000 })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.transactionOrder.create.mockResolvedValue({ id: 'tx1' })
    })

    it('应成功订阅并立即扣首期款（无试用期）', async () => {
      const result = await service.subscribe('sub1', 'SP1', { payPassword: '123456' })
      expect(result.id).toBe('sub_record')
      expect(prisma.subscription.create).toHaveBeenCalled()
      expect(prisma.subscriptionCharge.create).toHaveBeenCalled()
    })

    it('应支持试用期：不立即扣款，设置 nextChargeAt=trialEnd', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({ ...plan, trialDays: 7 })
      const result = await service.subscribe('sub1', 'SP1', { payPassword: '123456' })
      expect(result.id).toBe('sub_record')
      // 试用期不调用 executeCharge
      expect(prisma.subscriptionCharge.create).not.toHaveBeenCalled()
    })

    it('计划不存在应抛 NotFound', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue(null)
      await expect(
        service.subscribe('sub1', 'SP1', { payPassword: '123456' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('计划禁用应抛 BadRequest', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue({ ...plan, status: 'DISABLED' })
      await expect(
        service.subscribe('sub1', 'SP1', { payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('不能订阅自己的计划', async () => {
      const ownPlan = { ...plan, ownerId: 'sub1' }
      prisma.subscriptionPlan.findUnique.mockResolvedValue(ownPlan)
      await expect(
        service.subscribe('sub1', 'SP1', { payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('订阅者未实名应抛 Forbidden', async () => {
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'sub1') return Promise.resolve({ ...subscriber, realNameStatus: RealNameStatus.UNVERIFIED })
        return Promise.resolve(owner)
      })
      await expect(
        service.subscribe('sub1', 'SP1', { payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('风控拦截应抛 Forbidden', async () => {
      riskEngine.check.mockResolvedValue({ blocked: true, rules: [{ name: 'rule1', action: 'BLOCK' }] })
      await expect(
        service.subscribe('sub1', 'SP1', { payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('幂等键命中应返回已有订阅', async () => {
      prisma.subscription.findUnique.mockResolvedValueOnce({
        id: 'existing',
        subscriptionNo: 'SUB_OLD',
        subscriberId: 'sub1',
      })
      const result = await service.subscribe('sub1', 'SP1', {
        payPassword: '123456',
        idempotencyKey: 'idem1',
      })
      expect(result.id).toBe('existing')
    })

    it('已订阅该计划应抛 BadRequest', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'active',
        status: SubscriptionStatus.ACTIVE,
      })
      await expect(
        service.subscribe('sub1', 'SP1', { payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== cancel ==============
  describe('cancel', () => {
    it('应成功取消订阅', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce({
          id: 'sub1',
          subscriptionNo: 'SUB1',
          subscriberId: 'user1',
          status: SubscriptionStatus.ACTIVE,
        })
        .mockResolvedValueOnce({
          id: 'sub1',
          status: SubscriptionStatus.CANCELLED,
        })
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.cancel('user1', 'SUB1', '不想要了')
      expect(result?.status).toBe(SubscriptionStatus.CANCELLED)
    })

    it('订阅不存在应抛 NotFound', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null)
      await expect(service.cancel('user1', 'SUB1')).rejects.toThrow(NotFoundException)
    })

    it('非订阅者应抛 Forbidden', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'other',
        status: SubscriptionStatus.ACTIVE,
      })
      await expect(service.cancel('user1', 'SUB1')).rejects.toThrow(ForbiddenException)
    })

    it('已取消的订阅应抛 BadRequest', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'user1',
        status: SubscriptionStatus.CANCELLED,
      })
      await expect(service.cancel('user1', 'SUB1')).rejects.toThrow(BadRequestException)
    })
  })

  // ============== suspend / resume ==============
  describe('suspend', () => {
    it('应成功暂停订阅', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce({
          id: 'sub1',
          subscriberId: 'user1',
          status: SubscriptionStatus.ACTIVE,
        })
        .mockResolvedValueOnce({
          id: 'sub1',
          status: SubscriptionStatus.SUSPENDED,
        })
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.suspend('user1', 'SUB1')
      expect(result?.status).toBe(SubscriptionStatus.SUSPENDED)
    })

    it('非 ACTIVE 状态应抛 BadRequest', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'user1',
        status: SubscriptionStatus.CANCELLED,
      })
      await expect(service.suspend('user1', 'SUB1')).rejects.toThrow(BadRequestException)
    })
  })

  describe('resume', () => {
    it('应成功恢复订阅', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce({
          id: 'sub1',
          subscriberId: 'user1',
          status: SubscriptionStatus.SUSPENDED,
          nextChargeAt: null,
          plan: { id: 'p1', ownerId: 'owner1', amount: 1000, period: 'MONTHLY', intervalCount: 1 },
        })
        .mockResolvedValueOnce({
          id: 'sub1',
          status: SubscriptionStatus.ACTIVE,
        })
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.resume('user1', 'SUB1')
      expect(result?.status).toBe(SubscriptionStatus.ACTIVE)
    })

    it('非 SUSPENDED 状态应抛 BadRequest', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'user1',
        status: SubscriptionStatus.ACTIVE,
        plan: {},
      })
      await expect(service.resume('user1', 'SUB1')).rejects.toThrow(BadRequestException)
    })
  })

  // ============== findBySubscriptionNo ==============
  describe('findBySubscriptionNo', () => {
    it('订阅者可查看', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'user1',
        plan: { ownerId: 'owner1' },
      })
      const result = await service.findBySubscriptionNo('user1', 'SUB1')
      expect(result.id).toBe('sub1')
    })

    it('plan owner 也可查看', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'sub_other',
        plan: { ownerId: 'owner1' },
      })
      const result = await service.findBySubscriptionNo('owner1', 'SUB1')
      expect(result.id).toBe('sub1')
    })

    it('第三方无权查看应抛 Forbidden', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'sub_other',
        plan: { ownerId: 'owner_other' },
      })
      await expect(
        service.findBySubscriptionNo('user1', 'SUB1'),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  // ============== list ==============
  describe('list', () => {
    it('应返回用户订阅列表', async () => {
      prisma.subscription.findMany.mockResolvedValue([{ id: 'sub1' }])
      prisma.subscription.count.mockResolvedValue(1)
      const result = await service.list('user1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
    })

    it('应支持 status 过滤', async () => {
      prisma.subscription.findMany.mockResolvedValue([])
      prisma.subscription.count.mockResolvedValue(0)
      await service.list('user1', { status: 'ACTIVE' })
      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      )
    })
  })

  // ============== listCharges ==============
  describe('listCharges', () => {
    it('应返回扣款记录列表', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        subscriberId: 'user1',
        plan: { ownerId: 'owner1' },
      })
      prisma.subscriptionCharge.findMany.mockResolvedValue([{ id: 'c1' }])
      prisma.subscriptionCharge.count.mockResolvedValue(1)
      const result = await service.listCharges('user1', 'SUB1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
    })

    it('订阅不存在应抛 NotFound', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null)
      await expect(
        service.listCharges('user1', 'SUB1', {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ============== autoCharge ==============
  describe('autoCharge', () => {
    it('应扫描到期订阅并尝试扣款', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub1',
          subscriptionNo: 'SUB1',
          status: SubscriptionStatus.ACTIVE,
          plan: { id: 'p1', ownerId: 'owner1', amount: 1000, period: 'MONTHLY', intervalCount: 1 },
        },
      ])
      // chargeOnce 内部会调用 $transaction，由于 withLock mock，会执行
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub1',
        status: SubscriptionStatus.ACTIVE,
        completedCycles: 0,
        currentCycleStart: new Date(),
        currentCycleEnd: new Date(),
        plan: { id: 'p1', ownerId: 'owner1', amount: 1000, period: 'MONTHLY', intervalCount: 1, totalCycles: null },
      })
      prisma.subscriptionCharge.findMany.mockResolvedValue([])
      prisma.subscriptionCharge.create.mockResolvedValue({ id: 'c1' })
      prisma.subscriptionCharge.update.mockResolvedValue({ id: 'c1', status: 'SUCCESS' })
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc1',
        status: AccountStatus.ACTIVE,
        availableBalance: 10000,
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 9000 })
      prisma.transactionOrder.create.mockResolvedValue({ id: 'tx1' })

      const result = await service.autoCharge()
      expect(result.total).toBe(1)
    })

    it('无到期订阅应返回 0', async () => {
      prisma.subscription.findMany.mockResolvedValue([])
      const result = await service.autoCharge()
      expect(result.total).toBe(0)
      expect(result.success).toBe(0)
    })

    it('扣款异常应计入失败数', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub1',
          subscriptionNo: 'SUB1',
          status: SubscriptionStatus.ACTIVE,
          plan: { id: 'p1', ownerId: 'owner1', amount: 1000, period: 'MONTHLY', intervalCount: 1 },
        },
      ])
      // 内部 findUnique 返回 null → 抛 Error
      prisma.subscription.findUnique.mockResolvedValue(null)

      const result = await service.autoCharge()
      expect(result.total).toBe(1)
      expect(result.failed).toBe(1)
    })
  })
})
