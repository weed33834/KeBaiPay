import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { MerchantsService } from './merchants.service'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../crypto/crypto.service'
import { MerchantStatus } from '../common/enums'

type PrismaMock = {
  user: Record<string, jest.Mock>
  merchant: Record<string, jest.Mock>
  merchantApp: Record<string, jest.Mock>
  qrCode: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
} & Record<string, unknown>

type CryptoMock = {
  encrypt: jest.Mock
  decrypt: jest.Mock
  mask: jest.Mock
}

type CreateArgs = { data: Record<string, unknown> }

describe('MerchantsService', () => {
  let service: MerchantsService
  let prisma: PrismaMock
  let cryptoService: CryptoMock

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      merchant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      merchantApp: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      qrCode: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      paymentOrder: { aggregate: jest.fn() },
    }

    cryptoService = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn((v: string) => (v.startsWith('enc:') ? v.slice(4) : v)),
      mask: jest.fn((v: string) => (v.length > 8 ? `${v.slice(0, 4)}****${v.slice(-4)}` : '****')),
    }

    const module = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: cryptoService },
      ],
    }).compile()

    service = module.get(MerchantsService)
  })

  const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    ...overrides,
  })

  const baseMerchant = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    userId: 'u1',
    merchantNo: 'M123456',
    merchantName: '测试商户',
    merchantType: 'PERSONAL',
    businessLicenseNo: null,
    contactName: null,
    contactPhone: null,
    settleAccount: null,
    status: 'PENDING',
    rejectReason: null,
    reviewedBy: null,
    reviewedAt: null,
    payRate: 60,
    withdrawRate: 60,
    dailyLimit: 10000000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  })

  describe('register 商户注册', () => {
    it('用户不存在报错', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      await expect(
        service.register('u1', { merchantName: '测试商户' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('未实名认证报错', async () => {
      prisma.user.findUnique.mockResolvedValue(verifiedUser({ realNameStatus: 'UNVERIFIED' }))
      await expect(
        service.register('u1', { merchantName: '测试商户' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('已申请过商户报错', async () => {
      prisma.user.findUnique.mockResolvedValue(verifiedUser())
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      await expect(
        service.register('u1', { merchantName: '测试商户' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('正常创建商户并生成默认费率/限额', async () => {
      prisma.user.findUnique.mockResolvedValue(verifiedUser())
      prisma.merchant.findUnique.mockResolvedValue(null)
      prisma.merchant.create.mockImplementation((args: unknown) =>
        Promise.resolve({ id: 'm1', ...(args as CreateArgs).data, createdAt: new Date(), updatedAt: new Date() }),
      )

      const result = await service.register('u1', { merchantName: '测试商户' })
      expect(result.status).toBe('PENDING')
      expect(result.payRate).toBe(60)
      expect(result.withdrawRate).toBe(60)
      expect(result.dailyLimit).toBe(10000000)
      expect(result.dailyLimitYuan).toBe('100000.00')
      expect(prisma.merchant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            merchantName: '测试商户',
            merchantType: 'PERSONAL',
            status: 'PENDING',
            payRate: 60,
            withdrawRate: 60,
            dailyLimit: 10000000,
          }),
        }),
      )
    })
  })

  describe('getMyMerchant 查询我的商户', () => {
    it('找不到商户报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.getMyMerchant('u1')).rejects.toThrow(NotFoundException)
    })

    it('正常返回商户信息', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      const result = await service.getMyMerchant('u1')
      expect(result.merchantName).toBe('测试商户')
      expect(result.dailyLimitYuan).toBe('100000.00')
    })
  })

  describe('updateMyMerchant 更新我的商户', () => {
    it('找不到商户报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.updateMyMerchant('u1', { merchantName: '新名称' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('非 PENDING/REJECTED 状态报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      await expect(
        service.updateMyMerchant('u1', { merchantName: '新名称' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('PENDING 状态可更新资料', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      prisma.merchant.update.mockImplementation((args: unknown) =>
        Promise.resolve({ ...baseMerchant(), ...(args as CreateArgs).data }),
      )

      const result = await service.updateMyMerchant('u1', {
        merchantName: '新名称',
        contactName: '李四',
        contactPhone: '13800138000',
      })
      expect(result.merchantName).toBe('新名称')
      expect(result.contactName).toBe('李四')
    })

    it('REJECTED 状态可更新资料', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'REJECTED' }))
      prisma.merchant.update.mockImplementation((args: unknown) =>
        Promise.resolve({ ...baseMerchant({ status: 'REJECTED' }), ...(args as CreateArgs).data }),
      )

      const result = await service.updateMyMerchant('u1', { merchantName: '修改后' })
      expect(result.merchantName).toBe('修改后')
    })
  })

  describe('listMerchants 商户列表', () => {
    it('支持按状态筛选并分页返回', async () => {
      prisma.merchant.findMany.mockResolvedValue([baseMerchant()])
      prisma.merchant.count.mockResolvedValue(1)

      const result = await service.listMerchants({ status: MerchantStatus.PENDING, page: 1, limit: 10 })
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(10)
      expect(result.data[0].status).toBe('PENDING')
      expect(prisma.merchant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
          skip: 0,
          take: 10,
        }),
      )
    })
  })

  describe('auditMerchant 审核商户', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.auditMerchant('m1', { status: MerchantStatus.APPROVED }, 'admin1'),
      ).rejects.toThrow(NotFoundException)
    })

    it('只能审核 PENDING 状态的商户', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      await expect(
        service.auditMerchant('m1', { status: MerchantStatus.APPROVED }, 'admin1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('审核通过成功', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      // H3: updateMany + status:PENDING 原子守卫，返回 count=1 表示更新成功
      prisma.merchant.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.auditMerchant('m1', { status: MerchantStatus.APPROVED }, 'admin1')
      expect(result.status).toBe('APPROVED')
      expect(result.reviewedBy).toBe('admin1')
      // H3: 通过 updateMany + status:PENDING 原子守卫更新
      expect(prisma.merchant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'admin1' }),
        }),
      )
    })

    it('拒绝审核必须填写原因', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      await expect(
        service.auditMerchant('m1', { status: MerchantStatus.REJECTED }, 'admin1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('拒绝审核成功并记录原因', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      // H3: updateMany + status:PENDING 原子守卫，返回 count=1 表示更新成功
      prisma.merchant.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.auditMerchant(
        'm1',
        { status: MerchantStatus.REJECTED, rejectReason: '资料不全' },
        'admin1',
      )
      expect(result.status).toBe('REJECTED')
      expect(result.rejectReason).toBe('资料不全')
      // H3: 通过 updateMany + status:PENDING 原子守卫更新
      expect(prisma.merchant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'REJECTED', rejectReason: '资料不全' }),
        }),
      )
    })
  })

  describe('updateMerchantConfig 调整商户配置', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.updateMerchantConfig('m1', { payRate: 30 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('收款费率越界报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      await expect(
        service.updateMerchantConfig('m1', { payRate: -1 }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.updateMerchantConfig('m1', { payRate: 10001 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('日限额非法报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      await expect(
        service.updateMerchantConfig('m1', { dailyLimit: 0 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('未传任何配置报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      await expect(service.updateMerchantConfig('m1', {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('成功调整收款费率、提现费率和日限额', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      prisma.merchant.update.mockImplementation((args: unknown) =>
        Promise.resolve({ ...baseMerchant(), ...(args as CreateArgs).data }),
      )

      const result = await service.updateMerchantConfig('m1', {
        payRate: 30,
        withdrawRate: 50,
        dailyLimit: 50000,
      })
      expect(result.payRate).toBe(30)
      expect(result.withdrawRate).toBe(50)
      expect(result.dailyLimit).toBe(5000000)
      expect(result.dailyLimitYuan).toBe('50000.00')
      expect(prisma.merchant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { payRate: 30, withdrawRate: 50, dailyLimit: 5000000 },
        }),
      )
    })
  })

  describe('createApp 创建应用', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.createApp('u1', { name: '应用1' })).rejects.toThrow(NotFoundException)
    })

    it('商户未审核通过报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'PENDING' }))
      await expect(service.createApp('u1', { name: '应用1' })).rejects.toThrow(ForbiddenException)
    })

    it('正常创建应用并返回明文密钥', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.merchantApp.create.mockImplementation((args: unknown) =>
        Promise.resolve({ id: 'app-record-1', ...(args as CreateArgs).data, createdAt: new Date(), updatedAt: new Date() }),
      )

      const result = await service.createApp('u1', { name: '应用1', callbackUrl: 'https://example.com/cb' })
      expect(result.name).toBe('应用1')
      expect(result.appId).toMatch(/^app_[a-f0-9]+$/)
      expect(result.appSecret).toMatch(/^[a-f0-9]{32}$/)
    })
  })

  describe('listApps 应用列表', () => {
    it('appSecret 需要脱敏', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.merchantApp.findMany.mockResolvedValue([
        {
          id: 'a1',
          merchantId: 'm1',
          appId: 'app_12345678abcdef',
          appSecret: '1234567890abcdef1234567890abcdef',
          name: '应用1',
          callbackUrl: null,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const result = await service.listApps('u1')
      expect(result[0].appSecret).toBe('1234****cdef')
    })
  })

  describe('regenerateSecret 重置应用密钥', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.regenerateSecret('u1', 'app_123')).rejects.toThrow(NotFoundException)
    })

    it('应用不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.merchantApp.findFirst.mockResolvedValue(null)
      await expect(service.regenerateSecret('u1', 'app_123')).rejects.toThrow(NotFoundException)
    })

    it('重置成功并返回新密钥', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.merchantApp.findFirst.mockResolvedValue({ id: 'a1', appSecret: 'old_secret' })
      prisma.merchantApp.update.mockImplementation((args: unknown) =>
        Promise.resolve({ id: 'a1', ...(args as CreateArgs).data }),
      )

      const result = await service.regenerateSecret('u1', 'app_123')
      expect(result.appSecret).toMatch(/^[a-f0-9]{32}$/)
      expect(result.appSecret).not.toBe('old_secret')
    })
  })

  describe('createQrCode 生成收款码', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.createQrCode('u1', { amount: 10 })).rejects.toThrow(NotFoundException)
    })

    it('商户未审核通过报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'PENDING' }))
      await expect(service.createQrCode('u1', { amount: 10 })).rejects.toThrow(ForbiddenException)
    })

    it('金额非法报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      await expect(service.createQrCode('u1', { amount: 0 })).rejects.toThrow(BadRequestException)
      await expect(service.createQrCode('u1', { amount: -1 })).rejects.toThrow(BadRequestException)
    })

    it('正常生成收款码', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.qrCode.create.mockImplementation((args: unknown) =>
        Promise.resolve({ id: 'q1', ...(args as CreateArgs).data, createdAt: new Date(), updatedAt: new Date() }),
      )

      const result = await service.createQrCode('u1', { amount: 12.34, remark: '备注' })
      expect(result.amount).toBe(1234)
      expect(result.amountYuan).toBe('12.34')
      expect(result.remark).toBe('备注')
      expect(result.status).toBe('ACTIVE')
    })
  })

  describe('listMyQrCodes 我的收款码列表', () => {
    it('只返回当前商户的 MERCHANT 类型收款码', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.qrCode.findMany.mockResolvedValue([
        { id: 'q1', code: 'KB-1', amount: 1000, merchantId: 'm1', type: 'MERCHANT', status: 'ACTIVE' },
      ])

      const result = await service.listMyQrCodes('u1')
      expect(result).toHaveLength(1)
      expect(result[0].amountYuan).toBe('10.00')
      expect(prisma.qrCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { merchantId: 'm1', type: 'MERCHANT' },
        }),
      )
    })
  })

  describe('deleteQrCode 删除收款码', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.deleteQrCode('u1', 'q1')).rejects.toThrow(NotFoundException)
    })

    it('收款码不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      prisma.qrCode.findUnique.mockResolvedValue(null)
      await expect(service.deleteQrCode('u1', 'q1')).rejects.toThrow(NotFoundException)
    })

    it('无权操作其他商户收款码', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      prisma.qrCode.findUnique.mockResolvedValue({
        id: 'q1',
        merchantId: 'm2',
        status: 'ACTIVE',
      })
      await expect(service.deleteQrCode('u1', 'q1')).rejects.toThrow(ForbiddenException)
    })

    it('软删除为 DISABLED', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant())
      prisma.qrCode.findUnique.mockResolvedValue({
        id: 'q1',
        merchantId: 'm1',
        status: 'ACTIVE',
      })
      prisma.qrCode.update.mockResolvedValue({ id: 'q1', merchantId: 'm1', status: 'DISABLED' })

      const result = await service.deleteQrCode('u1', 'q1')
      expect(result.status).toBe('DISABLED')
      expect(prisma.qrCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1' },
          data: { status: 'DISABLED' },
        }),
      )
    })
  })

  describe('getDashboard 商户看板', () => {
    it('商户不存在报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.getDashboard('u1')).rejects.toThrow(NotFoundException)
    })

    it('未审核通过报错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'PENDING' }))
      await expect(service.getDashboard('u1')).rejects.toThrow(ForbiddenException)
    })

    it('审核通过返回今日/近7日/近30日统计', async () => {
      prisma.merchant.findUnique.mockResolvedValue(baseMerchant({ status: 'APPROVED' }))
      prisma.paymentOrder.aggregate.mockResolvedValue({
        _count: { id: 5 },
        _sum: { amount: 50000, fee: 500 },
      })

      const result = await service.getDashboard('u1')
      expect(result.today.count).toBe(5)
      expect(result.today.amountYuan).toBe('500.00')
      expect(result.today.feeYuan).toBe('5.00')
      expect(result.today.netYuan).toBe('495.00')
      expect(result.week.count).toBe(5)
      expect(result.month.count).toBe(5)
      expect(prisma.paymentOrder.aggregate).toHaveBeenCalledTimes(3)
    })
  })
})
