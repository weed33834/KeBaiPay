import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { InvoicesService } from './invoices.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  InvoiceType,
  InvoiceStatus,
  MerchantStatus,
} from '../common/enums'

describe('InvoicesService', () => {
  let service: InvoicesService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      merchant: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      invoice: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    }

    const module = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get(InvoicesService)
  })

  // ============== createInvoice ==============
  describe('createInvoice', () => {
    const mockMerchant = {
      id: 'm1',
      userId: 'u1',
      status: MerchantStatus.APPROVED,
    }

    it('商户不存在应抛 404', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.createInvoice('m1', {
          type: 'NORMAL',
          title: '测试发票',
          amount: 1000,
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('商户未审核应抛 Forbidden', async () => {
      prisma.merchant.findUnique.mockResolvedValue({
        ...mockMerchant,
        status: MerchantStatus.PENDING,
      })
      await expect(
        service.createInvoice('m1', {
          type: 'NORMAL',
          title: '测试',
          amount: 1000,
        }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('金额小于等于 0 应抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(mockMerchant)
      await expect(
        service.createInvoice('m1', {
          type: 'NORMAL',
          title: '测试',
          amount: 0,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('专用发票无税号应抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(mockMerchant)
      await expect(
        service.createInvoice('m1', {
          type: 'SPECIAL',
          title: '测试',
          amount: 1000,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功创建普通发票', async () => {
      prisma.merchant.findUnique.mockResolvedValue(mockMerchant)
      prisma.invoice.create.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        status: InvoiceStatus.PENDING,
      })
      const result = await service.createInvoice('m1', {
        type: 'NORMAL',
        title: '测试',
        amount: 1000,
      })
      expect(result?.invoiceNo).toBe('INV1')
      expect(result?.status).toBe(InvoiceStatus.PENDING)
    })

    it('成功创建专用发票（含税号）', async () => {
      prisma.merchant.findUnique.mockResolvedValue(mockMerchant)
      prisma.invoice.create.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        type: InvoiceType.SPECIAL,
      })
      const result = await service.createInvoice('m1', {
        type: 'SPECIAL',
        title: '测试',
        amount: 1000,
        taxNo: '1234567890',
      })
      expect(result?.type).toBe(InvoiceType.SPECIAL)
    })
  })

  // ============== findByInvoiceNo ==============
  describe('findByInvoiceNo', () => {
    it('不存在应抛 404', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null)
      await expect(service.findByInvoiceNo('NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('无权查看他人发票应抛 Forbidden', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        merchantId: 'm-other',
      })
      await expect(service.findByInvoiceNo('INV1', 'm1')).rejects.toThrow(ForbiddenException)
    })

    it('成功查看自己的发票', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        merchantId: 'm1',
      })
      const result = await service.findByInvoiceNo('INV1', 'm1')
      expect(result?.invoiceNo).toBe('INV1')
    })

    it('管理员可查看任意发票', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        merchantId: 'm-other',
      })
      const result = await service.findByInvoiceNo('INV1') // 不传 merchantId
      expect(result?.invoiceNo).toBe('INV1')
    })
  })

  // ============== listByMerchant ==============
  describe('listByMerchant', () => {
    it('应返回分页列表', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'i1', merchantId: 'm1' },
      ])
      prisma.invoice.count.mockResolvedValue(1)
      const result = await service.listByMerchant('m1', {})
      expect(result.total).toBe(1)
    })

    it('status 过滤生效', async () => {
      prisma.invoice.findMany.mockResolvedValue([])
      await service.listByMerchant('m1', { status: 'PENDING' })
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { merchantId: 'm1', status: 'PENDING' },
        }),
      )
    })
  })

  // ============== listAll ==============
  describe('listAll', () => {
    it('应返回所有发票', async () => {
      prisma.invoice.findMany.mockResolvedValue([])
      prisma.invoice.count.mockResolvedValue(0)
      const result = await service.listAll({})
      expect(result.total).toBe(0)
    })
  })

  // ============== issue ==============
  describe('issue', () => {
    it('不存在应抛 404', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null)
      await expect(service.issue('NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('非 PENDING 状态应抛错', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        status: InvoiceStatus.ISSUED,
      })
      await expect(service.issue('INV1')).rejects.toThrow(BadRequestException)
    })

    it('成功开具发票', async () => {
      prisma.invoice.findUnique
        .mockResolvedValueOnce({
          id: 'i1',
          invoiceNo: 'INV1',
          status: InvoiceStatus.PENDING,
        })
        .mockResolvedValueOnce({
          id: 'i1',
          status: InvoiceStatus.ISSUED,
        })
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.issue('INV1')
      expect(result?.status).toBe(InvoiceStatus.ISSUED)
    })

    it('乐观锁失败应抛错', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        status: InvoiceStatus.PENDING,
      })
      prisma.invoice.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.issue('INV1')).rejects.toThrow(BadRequestException)
    })
  })

  // ============== cancel ==============
  describe('cancel', () => {
    it('不存在应抛 404', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null)
      await expect(service.cancel('NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('已作废状态应抛错', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        status: InvoiceStatus.CANCELLED,
      })
      await expect(service.cancel('INV1')).rejects.toThrow(BadRequestException)
    })

    it('成功作废 PENDING 发票', async () => {
      prisma.invoice.findUnique
        .mockResolvedValueOnce({
          id: 'i1',
          invoiceNo: 'INV1',
          status: InvoiceStatus.PENDING,
        })
        .mockResolvedValueOnce({
          id: 'i1',
          status: InvoiceStatus.CANCELLED,
        })
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.cancel('INV1')
      expect(result?.status).toBe(InvoiceStatus.CANCELLED)
    })

    it('成功作废 ISSUED 发票', async () => {
      prisma.invoice.findUnique
        .mockResolvedValueOnce({
          id: 'i1',
          invoiceNo: 'INV1',
          status: InvoiceStatus.ISSUED,
        })
        .mockResolvedValueOnce({
          id: 'i1',
          status: InvoiceStatus.CANCELLED,
        })
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.cancel('INV1')
      expect(result?.status).toBe(InvoiceStatus.CANCELLED)
    })
  })

  // ============== cancelByMerchant ==============
  describe('cancelByMerchant', () => {
    it('不存在应抛 404', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null)
      await expect(service.cancelByMerchant('m1', 'NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('无权作废他人发票应抛 Forbidden', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        merchantId: 'm-other',
        status: InvoiceStatus.PENDING,
      })
      await expect(service.cancelByMerchant('m1', 'INV1')).rejects.toThrow(ForbiddenException)
    })

    it('非 PENDING 状态应抛错', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        merchantId: 'm1',
        status: InvoiceStatus.ISSUED,
      })
      await expect(service.cancelByMerchant('m1', 'INV1')).rejects.toThrow(BadRequestException)
    })

    it('商户成功作废自己的 PENDING 发票', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'i1',
        invoiceNo: 'INV1',
        merchantId: 'm1',
        status: InvoiceStatus.PENDING,
      })
      prisma.invoice.update.mockResolvedValue({
        id: 'i1',
        status: InvoiceStatus.CANCELLED,
      })
      const result = await service.cancelByMerchant('m1', 'INV1')
      expect(result?.status).toBe(InvoiceStatus.CANCELLED)
    })
  })
})
