import { Test } from '@nestjs/testing'
import { BillsService } from './bills.service'
import { PrismaService } from '../prisma/prisma.service'
import { BillDirection } from '../common/enums'
import { fenToYuan } from '../common/helpers'

describe('BillsService', () => {
  let service: BillsService
  type PrismaMock = {
    bill: { findMany: jest.Mock }
  }

  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = {
      bill: { findMany: jest.fn() },
    }

    const module = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get(BillsService)
  })

  describe('findByUser 查询账单', () => {
    it('不传 direction 时只按 userId 查询', async () => {
      const bills = [{ id: 'b1', userId: 'u1' }]
      prisma.bill.findMany.mockResolvedValue(bills)

      const result = await service.findByUser('u1')

      expect(result).toBe(bills)
      expect(prisma.bill.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    })

    it('传 direction 时按 userId 和 direction 查询', async () => {
      const bills = [{ id: 'b2', userId: 'u1', direction: BillDirection.INCOME }]
      prisma.bill.findMany.mockResolvedValue(bills)

      const result = await service.findByUser('u1', BillDirection.INCOME)

      expect(result).toBe(bills)
      expect(prisma.bill.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', direction: BillDirection.INCOME },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    })
  })

  describe('fenToYuan 金额格式化', () => {
    it('将分转换为元并保留两位小数', () => {
      expect(fenToYuan(100)).toBe('1.00')
      expect(fenToYuan(0)).toBe('0.00')
      expect(fenToYuan(12345)).toBe('123.45')
    })
  })
})
