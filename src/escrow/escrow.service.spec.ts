import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { EscrowService } from './escrow.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { EscrowStatus } from '../common/enums'
import { KBErrorCodes } from '../common/error-codes'

describe('EscrowService', () => {
  let service: EscrowService
  let prisma: any
  let usersService: any
  let riskEngine: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      escrowOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ availableBalance: 200 }),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
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
        EscrowService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()
    service = module.get(EscrowService)
  })

  describe('create 创建订单', () => {
    it('金额无效抛 ORDER_AMOUNT_INVALID', async () => {
      await expect(
        service.create('u1', { sellerId: 'u2', amount: 0, subject: 'T' } as any),
      ).rejects.toMatchObject({ message: expect.stringContaining(KBErrorCodes.ORDER_AMOUNT_INVALID) })
    })

    it('不能与自己担保交易', async () => {
      await expect(
        service.create('u1', { sellerId: 'u1', amount: 10, subject: 'T' } as any),
      ).rejects.toMatchObject({ message: expect.stringContaining(KBErrorCodes.ESCROW_CANNOT_SELF) })
    })

    it('买家未实名抛 REAL_NAME_REQUIRED', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'UNVERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      usersService.findById.mockResolvedValueOnce({ id: 'u2' })
      await expect(
        service.create('u1', { sellerId: 'u2', amount: 10, subject: 'T' } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('正常创建返回订单', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      usersService.findById.mockResolvedValueOnce({
        id: 'u2',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      const fakeOrder = { id: 'e1', orderNo: 'E1', status: EscrowStatus.CREATED }
      prisma.escrowOrder.create.mockResolvedValue(fakeOrder)
      const result = await service.create('u1', { sellerId: 'u2', amount: 10, subject: 'T' } as any)
      expect(result).toEqual(fakeOrder)
      expect(prisma.escrowOrder.create).toHaveBeenCalled()
    })
  })

  describe('pay 付款', () => {
    it('订单不存在抛 ESCROW_ORDER_NOT_FOUND', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(null)
      await expect(service.pay('u1', 'E1', 'pwd')).rejects.toThrow(NotFoundException)
    })

    it('非买家调用抛 ESCROW_BUYER_ONLY', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        orderNo: 'E1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.CREATED,
        amount: 1000,
        expiredAt: new Date(Date.now() + 60000),
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.pay('u3', 'E1', 'pwd')).rejects.toThrow(ForbiddenException)
    })

    it('状态非 CREATED 抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        orderNo: 'E1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.PAID,
        amount: 1000,
        expiredAt: new Date(Date.now() + 60000),
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.pay('u1', 'E1', 'pwd')).rejects.toThrow(BadRequestException)
    })

    it('正常付款：余额扣减并冻结', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.account.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          orderNo: 'E1',
          buyerId: 'u1',
          sellerId: 'u2',
          status: EscrowStatus.CREATED,
          amount: 1000,
          expiredAt: new Date(Date.now() + 60000),
          buyer: { nickname: 'B' },
          seller: { nickname: 'S' },
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.PAID })
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 5000,
          frozenBalance: 0,
          status: 'ACTIVE',
        })
        .mockResolvedValueOnce({
          id: 'a1',
          availableBalance: 4000,
          frozenBalance: 1000,
        })
      prisma.account.updateMany.mockResolvedValueOnce({ count: 1 }) // 扣款
      prisma.escrowOrder.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.pay('u1', 'E1', 'pwd')
      expect(result!.status).toBe(EscrowStatus.PAID)
      expect(usersService.verifyPayPassword).toHaveBeenCalledWith('u1', 'pwd')
      expect(prisma.account.updateMany).toHaveBeenCalled()
    })
  })

  describe('ship 发货', () => {
    it('非卖家抛 ESCROW_SELLER_ONLY', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        sellerId: 'u2',
        status: EscrowStatus.PAID,
      })
      await expect(service.ship('u3', 'E1')).rejects.toThrow(ForbiddenException)
    })

    it('非 PAID 状态抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        sellerId: 'u2',
        status: EscrowStatus.CREATED,
      })
      await expect(service.ship('u2', 'E1')).rejects.toThrow(BadRequestException)
    })

    it('正常发货', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          sellerId: 'u2',
          status: EscrowStatus.PAID,
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.SHIPPED })
      const result = await service.ship('u2', 'E1')
      expect(result!.status).toBe(EscrowStatus.SHIPPED)
    })
  })

  describe('confirm 确认收货', () => {
    it('非买家抛 ESCROW_BUYER_ONLY', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.SHIPPED,
        amount: 1000,
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.confirm('u3', 'E1')).rejects.toThrow(ForbiddenException)
    })

    it('非 SHIPPED 状态抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.CREATED,
        amount: 1000,
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.confirm('u1', 'E1')).rejects.toThrow(BadRequestException)
    })

    it('正常确认：买家冻结扣减 + 卖家余额增加', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          buyerId: 'u1',
          sellerId: 'u2',
          status: EscrowStatus.SHIPPED,
          amount: 1000,
          buyer: { nickname: 'B' },
          seller: { nickname: 'S' },
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.RECEIVED })
      prisma.account.findUnique
        .mockResolvedValueOnce({ id: 'a1', userId: 'u1', frozenBalance: 1000 })
        .mockResolvedValueOnce({ id: 'a2', userId: 'u2', availableBalance: 0 })
        .mockResolvedValueOnce({ id: 'a1', userId: 'u1', frozenBalance: 0 })
      prisma.account.update = jest.fn().mockResolvedValue({ availableBalance: 1000 })

      const result = await service.confirm('u1', 'E1')
      expect(result!.status).toBe(EscrowStatus.RECEIVED)
    })
  })

  describe('cancel 取消', () => {
    it('非 CREATED 状态抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        status: EscrowStatus.PAID,
      })
      await expect(service.cancel('u1', 'E1')).rejects.toThrow(BadRequestException)
    })

    it('CREATED 状态正常取消', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          buyerId: 'u1',
          status: EscrowStatus.CREATED,
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.CANCELLED })
      const result = await service.cancel('u1', 'E1')
      expect(result!.status).toBe(EscrowStatus.CANCELLED)
    })
  })

  describe('findByOrderNo 查询', () => {
    it('订单不存在抛 ESCROW_ORDER_NOT_FOUND', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(null)
      await expect(service.findByOrderNo('u1', 'E1')).rejects.toThrow(NotFoundException)
    })

    it('非买家/卖家无权查看', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        sellerId: 'u2',
      })
      await expect(service.findByOrderNo('u3', 'E1')).rejects.toThrow(ForbiddenException)
    })

    it('买家可查看', async () => {
      const order = { id: 'e1', buyerId: 'u1', sellerId: 'u2' }
      prisma.escrowOrder.findUnique.mockResolvedValue(order)
      const result = await service.findByOrderNo('u1', 'E1')
      expect(result).toEqual(order)
    })
  })

  describe('autoExpire 调度', () => {
    it('无超时订单返回 0', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([])
      const count = await service.autoExpire()
      expect(count).toBe(0)
    })

    it('有超时订单返回数量', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([
        { id: 'e1', orderNo: 'E1' },
        { id: 'e2', orderNo: 'E2' },
      ])
      const count = await service.autoExpire()
      expect(count).toBe(2)
      expect(prisma.escrowOrder.updateMany).toHaveBeenCalledTimes(2)
    })
  })
})
