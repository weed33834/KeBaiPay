import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { SplitsService } from './splits.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import {
  SplitStatus,
  SplitItemStatus,
  RealNameStatus,
  UserStatus,
  RiskLevel,
  AccountStatus,
  TransactionStatus,
} from '../common/enums'

describe('SplitsService', () => {
  let service: SplitsService
  let prisma: any
  let usersService: any
  let riskEngine: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      splitOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      splitItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        create: jest.fn(),
      },
      transactionOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'tx1' }),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ availableBalance: 100 }),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
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
        SplitsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(SplitsService)
  })

  // ============== createSplit ==============
  describe('createSplit', () => {
    const sourceOrder = {
      id: 'order1',
      orderNo: 'T123',
      status: TransactionStatus.SUCCESS,
      amount: 100000,
      fromUserId: 'sender1',
    }
    const sender = {
      id: 'sender1',
      realNameStatus: RealNameStatus.VERIFIED,
      status: UserStatus.ACTIVE,
      riskLevel: RiskLevel.LOW,
    }
    const senderAccount = {
      id: 'acc1',
      userId: 'sender1',
      availableBalance: 1000000,
      status: AccountStatus.ACTIVE,
    }

    beforeEach(() => {
      usersService.findById.mockResolvedValue(sender)
      prisma.transactionOrder.findFirst.mockResolvedValue(sourceOrder)
      prisma.account.findUnique.mockResolvedValue(senderAccount)
      prisma.splitOrder.create.mockResolvedValue({
        id: 'split1',
        splitNo: 'SPL1',
        senderId: 'sender1',
        sourceOrderNo: 'T123',
        sourceAmount: 100000,
        splitAmount: 1000,
        receiverCount: 1,
        status: SplitStatus.PENDING,
        items: [
          { id: 'item1', receiverId: 'recv1', amount: 1000, status: SplitItemStatus.PENDING },
        ],
      })
      prisma.splitOrder.updateMany.mockResolvedValue({ count: 1 })
      prisma.splitOrder.findUnique.mockResolvedValue({
        id: 'split1',
        splitNo: 'SPL1',
        senderId: 'sender1',
        sourceOrderNo: 'T123',
        sourceAmount: 100000,
        splitAmount: 1000,
        receiverCount: 1,
        status: SplitStatus.PROCESSING,
        items: [
          { id: 'item1', receiverId: 'recv1', amount: 1000, status: SplitItemStatus.PENDING },
        ],
      })
      // processSplitItem 内部 mock
      prisma.splitItem.findUnique.mockResolvedValue({
        id: 'item1',
        receiverId: 'recv1',
        amount: 1000,
        status: SplitItemStatus.PENDING,
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'recv1',
        realNameStatus: RealNameStatus.VERIFIED,
        status: UserStatus.ACTIVE,
        nickname: 'receiver',
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc1',
        status: AccountStatus.ACTIVE,
        availableBalance: 1000000,
      })
      prisma.account.update.mockResolvedValue({ availableBalance: 1001000 })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.transactionOrder.create.mockResolvedValue({ id: 'tx1' })
    })

    it('应成功发起分账（1 笔明细）', async () => {
      const result = await service.createSplit('sender1', {
        sourceOrderNo: 'T123',
        receivers: [{ receiverId: 'recv1', amount: 10 }],
      } as any)
      expect(result?.splitNo).toBe('SPL1')
      expect(prisma.splitOrder.create).toHaveBeenCalled()
    })

    it('接收方列表为空应抛 BadRequest', async () => {
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [],
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('接收方重复应抛 BadRequest', async () => {
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [
            { receiverId: 'recv1', amount: 10 },
            { receiverId: 'recv1', amount: 5 },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('包含自己应抛 BadRequest', async () => {
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'sender1', amount: 10 }],
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('金额无效应抛 BadRequest', async () => {
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'recv1', amount: 0 }],
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('sender 未实名应抛 Forbidden', async () => {
      usersService.findById.mockResolvedValue({
        ...sender,
        realNameStatus: RealNameStatus.UNVERIFIED,
      })
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'recv1', amount: 10 }],
        } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('源订单不存在应抛 NotFound', async () => {
      prisma.transactionOrder.findFirst.mockResolvedValue(null)
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'NOT_EXIST',
          receivers: [{ receiverId: 'recv1', amount: 10 }],
        } as any),
      ).rejects.toThrow(NotFoundException)
    })

    it('源订单非 SUCCESS 状态应抛 BadRequest', async () => {
      prisma.transactionOrder.findFirst.mockResolvedValue({
        ...sourceOrder,
        status: TransactionStatus.PENDING,
      })
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'recv1', amount: 10 }],
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('非源订单发起人应抛 Forbidden', async () => {
      prisma.transactionOrder.findFirst.mockResolvedValue({
        ...sourceOrder,
        fromUserId: 'other',
      })
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'recv1', amount: 10 }],
        } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('分账总额超过源订单金额应抛 BadRequest', async () => {
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'recv1', amount: 1000000 }],
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('风控拦截应抛 Forbidden', async () => {
      riskEngine.check.mockResolvedValue({
        blocked: true,
        rules: [{ name: 'rule1', action: 'BLOCK' }],
      })
      await expect(
        service.createSplit('sender1', {
          sourceOrderNo: 'T123',
          receivers: [{ receiverId: 'recv1', amount: 10 }],
        } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('幂等键命中应返回已有分账订单', async () => {
      prisma.splitOrder.findUnique.mockResolvedValueOnce({
        id: 'existing',
        splitNo: 'SPL_OLD',
        senderId: 'sender1',
        items: [],
      })
      const result = await service.createSplit('sender1', {
        sourceOrderNo: 'T123',
        receivers: [{ receiverId: 'recv1', amount: 10 }],
        idempotencyKey: 'idem1',
      } as any)
      expect(result?.id).toBe('existing')
    })
  })

  // ============== findBySplitNo ==============
  describe('findBySplitNo', () => {
    it('sender 可查看', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue({
        id: 'split1',
        senderId: 'user1',
        items: [{ receiverId: 'other' }],
      })
      const result = await service.findBySplitNo('user1', 'SPL1')
      expect(result.id).toBe('split1')
    })

    it('receiver 也可查看', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue({
        id: 'split1',
        senderId: 'other',
        items: [{ receiverId: 'user1' }],
      })
      const result = await service.findBySplitNo('user1', 'SPL1')
      expect(result.id).toBe('split1')
    })

    it('第三方无权查看应抛 Forbidden', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue({
        id: 'split1',
        senderId: 'other',
        items: [{ receiverId: 'other2' }],
      })
      await expect(service.findBySplitNo('user1', 'SPL1')).rejects.toThrow(ForbiddenException)
    })

    it('分账订单不存在应抛 NotFound', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue(null)
      await expect(service.findBySplitNo('user1', 'SPL1')).rejects.toThrow(NotFoundException)
    })
  })

  // ============== list ==============
  describe('list', () => {
    it('应返回分账列表', async () => {
      prisma.splitOrder.findMany.mockResolvedValue([{ id: 's1' }])
      prisma.splitOrder.count.mockResolvedValue(1)
      const result = await service.list('user1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
    })

    it('应支持 status 过滤', async () => {
      prisma.splitOrder.findMany.mockResolvedValue([])
      prisma.splitOrder.count.mockResolvedValue(0)
      await service.list('user1', { status: 'COMPLETED' })
      expect(prisma.splitOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      )
    })
  })

  // ============== cancel ==============
  describe('cancel', () => {
    it('应成功取消 PENDING 分账订单', async () => {
      prisma.splitOrder.findUnique
        .mockResolvedValueOnce({
          id: 'split1',
          senderId: 'user1',
          status: SplitStatus.PENDING,
        })
        .mockResolvedValueOnce({
          id: 'split1',
          status: SplitStatus.CANCELLED,
        })
      prisma.splitOrder.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.cancel('user1', 'SPL1')
      expect(result?.status).toBe(SplitStatus.CANCELLED)
    })

    it('非 sender 应抛 Forbidden', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue({
        id: 'split1',
        senderId: 'other',
        status: SplitStatus.PENDING,
      })
      await expect(service.cancel('user1', 'SPL1')).rejects.toThrow(ForbiddenException)
    })

    it('非 PENDING 状态应抛 BadRequest', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue({
        id: 'split1',
        senderId: 'user1',
        status: SplitStatus.COMPLETED,
      })
      await expect(service.cancel('user1', 'SPL1')).rejects.toThrow(BadRequestException)
    })

    it('分账订单不存在应抛 NotFound', async () => {
      prisma.splitOrder.findUnique.mockResolvedValue(null)
      await expect(service.cancel('user1', 'SPL1')).rejects.toThrow(NotFoundException)
    })
  })
})
