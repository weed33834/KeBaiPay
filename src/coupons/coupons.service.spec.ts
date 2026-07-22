import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { CouponsService } from './coupons.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import {
  CouponType,
  CouponStatus,
  UserCouponStatus,
  RealNameStatus,
} from '../common/enums'

describe('CouponsService', () => {
  let service: CouponsService
  let prisma: any
  let usersService: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      coupon: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      userCoupon: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
        CouponsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(CouponsService)
  })

  // ============== createCoupon ==============
  describe('createCoupon', () => {
    it('应成功创建固定金额优惠券', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.VERIFIED,
      })
      prisma.coupon.create.mockResolvedValue({ id: 'c1', couponNo: 'CP1' })
      const result = await service.createCoupon('owner1', {
        name: '满 10 减 1',
        type: CouponType.FIXED,
        value: 1,
        minAmountYuan: 10,
      } as any)
      expect(result.couponNo).toBe('CP1')
    })

    it('应成功创建百分比优惠券', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.VERIFIED,
      })
      prisma.coupon.create.mockResolvedValue({ id: 'c1', couponNo: 'CP1' })
      const result = await service.createCoupon('owner1', {
        name: '9 折',
        type: CouponType.PERCENT,
        value: 10,
      } as any)
      expect(result.couponNo).toBe('CP1')
    })

    it('owner 未实名应抛 Forbidden', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.UNVERIFIED,
      })
      await expect(
        service.createCoupon('owner1', {
          name: 'test',
          type: CouponType.FIXED,
          value: 1,
        } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('FIXED 类型金额无效应抛 BadRequest', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.VERIFIED,
      })
      await expect(
        service.createCoupon('owner1', {
          name: 'test',
          type: CouponType.FIXED,
          value: 0,
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('PERCENT 类型超出 1-99 范围应抛 BadRequest', async () => {
      usersService.findById.mockResolvedValue({
        id: 'owner1',
        realNameStatus: RealNameStatus.VERIFIED,
      })
      await expect(
        service.createCoupon('owner1', {
          name: 'test',
          type: CouponType.PERCENT,
          value: 150,
        } as any),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== findByCouponNo ==============
  describe('findByCouponNo', () => {
    it('应返回优惠券详情', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ id: 'c1', couponNo: 'CP1' })
      const result = await service.findByCouponNo('CP1')
      expect(result.id).toBe('c1')
    })

    it('优惠券不存在应抛 NotFound', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null)
      await expect(service.findByCouponNo('CP1')).rejects.toThrow(NotFoundException)
    })
  })

  // ============== listCoupons ==============
  describe('listCoupons', () => {
    it('应返回分页列表', async () => {
      prisma.coupon.findMany.mockResolvedValue([{ id: 'c1' }])
      prisma.coupon.count.mockResolvedValue(1)
      const result = await service.listCoupons('owner1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
    })

    it('应支持 status 过滤', async () => {
      prisma.coupon.findMany.mockResolvedValue([])
      prisma.coupon.count.mockResolvedValue(0)
      await service.listCoupons('owner1', { status: 'ACTIVE' })
      expect(prisma.coupon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      )
    })
  })

  // ============== setCouponStatus ==============
  describe('setCouponStatus', () => {
    it('应成功禁用优惠券', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        ownerId: 'owner1',
        status: 'ACTIVE',
      })
      prisma.coupon.update.mockResolvedValue({ id: 'c1', status: 'DISABLED' })
      const result = await service.setCouponStatus('owner1', 'CP1', 'DISABLED')
      expect(result.status).toBe('DISABLED')
    })

    it('非 owner 应抛 Forbidden', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        ownerId: 'other',
        status: 'ACTIVE',
      })
      await expect(
        service.setCouponStatus('owner1', 'CP1', 'DISABLED'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('状态未变化应抛 BadRequest', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1',
        ownerId: 'owner1',
        status: 'ACTIVE',
      })
      await expect(
        service.setCouponStatus('owner1', 'CP1', 'ACTIVE'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== claim ==============
  describe('claim', () => {
    const activeCoupon = {
      id: 'c1',
      couponNo: 'CP1',
      ownerId: 'owner1',
      status: CouponStatus.ACTIVE,
      expiresAt: null,
      totalQuota: 0,
      issuedCount: 0,
      perUserLimit: 1,
    }

    it('应成功领取优惠券', async () => {
      prisma.coupon.findUnique.mockResolvedValue(activeCoupon)
      prisma.userCoupon.count.mockResolvedValue(0)
      prisma.userCoupon.create.mockResolvedValue({
        id: 'uc1',
        userCouponNo: 'UC1',
      })
      prisma.coupon.update.mockResolvedValue({ issuedCount: 1 })
      const result = await service.claim('user1', 'CP1')
      expect(result.userCouponNo).toBe('UC1')
    })

    it('优惠券已禁用应抛 BadRequest', async () => {
      prisma.coupon.findUnique.mockResolvedValue({ ...activeCoupon, status: 'DISABLED' })
      await expect(service.claim('user1', 'CP1')).rejects.toThrow(BadRequestException)
    })

    it('优惠券已过期应抛 BadRequest', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        ...activeCoupon,
        expiresAt: new Date('2020-01-01'),
      })
      await expect(service.claim('user1', 'CP1')).rejects.toThrow(BadRequestException)
    })

    it('优惠券已被领完应抛 BadRequest', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        ...activeCoupon,
        totalQuota: 100,
        issuedCount: 100,
      })
      await expect(service.claim('user1', 'CP1')).rejects.toThrow(BadRequestException)
    })

    it('已领取过该优惠券应抛 BadRequest', async () => {
      prisma.coupon.findUnique.mockResolvedValue(activeCoupon)
      prisma.userCoupon.count.mockResolvedValue(1)
      await expect(service.claim('user1', 'CP1')).rejects.toThrow(BadRequestException)
    })

    it('优惠券不存在应抛 NotFound', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null)
      await expect(service.claim('user1', 'CP1')).rejects.toThrow(NotFoundException)
    })
  })

  // ============== listMyCoupons ==============
  describe('listMyCoupons', () => {
    it('应返回用户优惠券列表', async () => {
      prisma.userCoupon.findMany.mockResolvedValue([{ id: 'uc1' }])
      prisma.userCoupon.count.mockResolvedValue(1)
      const result = await service.listMyCoupons('user1', { page: 1, limit: 10 })
      expect(result.total).toBe(1)
    })
  })

  // ============== useUserCoupon ==============
  describe('useUserCoupon', () => {
    it('应成功使用 FIXED 优惠券并返回折扣金额', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userCouponNo: 'UC1',
        userId: 'user1',
        status: UserCouponStatus.AVAILABLE,
        coupon: {
          id: 'c1',
          status: CouponStatus.ACTIVE,
          expiresAt: null,
          type: CouponType.FIXED,
          value: 100, // 1 元
          minAmount: 500, // 满 5 元
        },
      })
      prisma.userCoupon.update.mockResolvedValue({ status: UserCouponStatus.USED })
      const result = await service.useUserCoupon('user1', 'UC1', {
        orderNo: 'T123',
        orderAmount: 10, // 10 元
      } as any)
      expect(result.discountAmount).toBe(100) // 1 元 = 100 分
      expect(result.finalAmount).toBe(900) // 9 元
    })

    it('应成功使用 PERCENT 优惠券', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userCouponNo: 'UC1',
        userId: 'user1',
        status: UserCouponStatus.AVAILABLE,
        coupon: {
          id: 'c1',
          status: CouponStatus.ACTIVE,
          expiresAt: null,
          type: CouponType.PERCENT,
          value: 10, // 9 折
          minAmount: 0,
        },
      })
      const result = await service.useUserCoupon('user1', 'UC1', {
        orderNo: 'T123',
        orderAmount: 100, // 100 元
      } as any)
      expect(result.discountAmount).toBe(1000) // 10 元 = 1000 分
      expect(result.finalAmount).toBe(9000) // 90 元
    })

    it('用户优惠券不存在应抛 NotFound', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue(null)
      await expect(
        service.useUserCoupon('user1', 'UC1', { orderNo: 'T1', orderAmount: 10 } as any),
      ).rejects.toThrow(NotFoundException)
    })

    it('非本人优惠券应抛 Forbidden', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userId: 'other',
        status: UserCouponStatus.AVAILABLE,
        coupon: {},
      })
      await expect(
        service.useUserCoupon('user1', 'UC1', { orderNo: 'T1', orderAmount: 10 } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('已使用的优惠券应抛 BadRequest', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userId: 'user1',
        status: UserCouponStatus.USED,
        coupon: {},
      })
      await expect(
        service.useUserCoupon('user1', 'UC1', { orderNo: 'T1', orderAmount: 10 } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('订单金额不满足满减门槛应抛 BadRequest', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userCouponNo: 'UC1',
        userId: 'user1',
        status: UserCouponStatus.AVAILABLE,
        coupon: {
          id: 'c1',
          status: CouponStatus.ACTIVE,
          expiresAt: null,
          type: CouponType.FIXED,
          value: 100,
          minAmount: 10000, // 满 100 元
        },
      })
      await expect(
        service.useUserCoupon('user1', 'UC1', { orderNo: 'T1', orderAmount: 10 } as any),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== findUserCoupon ==============
  describe('findUserCoupon', () => {
    it('应返回用户优惠券详情', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userId: 'user1',
        coupon: { id: 'c1' },
      })
      const result = await service.findUserCoupon('user1', 'UC1')
      expect(result.id).toBe('uc1')
    })

    it('非本人优惠券应抛 Forbidden', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue({
        id: 'uc1',
        userId: 'other',
        coupon: {},
      })
      await expect(service.findUserCoupon('user1', 'UC1')).rejects.toThrow(ForbiddenException)
    })

    it('用户优惠券不存在应抛 NotFound', async () => {
      prisma.userCoupon.findUnique.mockResolvedValue(null)
      await expect(service.findUserCoupon('user1', 'UC1')).rejects.toThrow(NotFoundException)
    })
  })

  // ============== autoExpire ==============
  describe('autoExpire', () => {
    it('应将过期优惠券标记为 EXPIRED', async () => {
      prisma.userCoupon.updateMany.mockResolvedValue({ count: 5 })
      const count = await service.autoExpire()
      expect(count).toBe(5)
      expect(prisma.userCoupon.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: UserCouponStatus.EXPIRED },
        }),
      )
    })

    it('无过期优惠券应返回 0', async () => {
      prisma.userCoupon.updateMany.mockResolvedValue({ count: 0 })
      const count = await service.autoExpire()
      expect(count).toBe(0)
    })
  })
})
