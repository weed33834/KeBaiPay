import { Test } from '@nestjs/testing'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { createHash } from 'crypto'
import { BankCardsService } from './bank-cards.service'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../crypto/crypto.service'
import { KBErrorCodes } from '../common/error-codes'
import { CreateBankCardDto } from './dto/create-bank-card.dto'

describe('BankCardsService', () => {
  let service: BankCardsService

  type PrismaMock = {
    $transaction: jest.Mock
    bankCard: Record<string, jest.Mock>
  } & Record<string, unknown>

  let prisma: PrismaMock
  let crypto: CryptoService

  const dto: CreateBankCardDto = {
    holderName: '张三',
    cardNumber: '6222001234567890123',
    bankName: '工商银行',
    branchName: '北京分行',
    phone: '13800138000',
    cardType: 'DEBIT',
  }

  beforeEach(async () => {
    prisma = {
      bankCard: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return cb(prisma)
        const results = []
        for (const op of cb as unknown[]) {
          results.push(await op)
        }
        return results
      }),
    } as unknown as PrismaMock

    crypto = {
      encrypt: jest.fn((text: string) => `enc_${text}`),
      decrypt: jest.fn((text: string) => text.replace(/^enc_/, '')),
      mask: jest.fn(),
    } as unknown as CryptoService

    const module = await Test.createTestingModule({
      providers: [
        BankCardsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile()
    service = module.get(BankCardsService)
  })

  describe('create 绑卡', () => {
    it('正常绑卡：返回脱敏卡号', async () => {
      prisma.bankCard.create.mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        holderName: '张三',
        cardNumber: 'enc_6222001234567890123',
        bankName: '工商银行',
        branchName: '北京分行',
        phone: 'enc_13800138000',
        cardType: 'DEBIT',
        isDefault: true,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await service.create('u1', dto)

      // 卡号哈希正确计算
      const expectedHash = createHash('sha256').update(dto.cardNumber).digest('hex')
      expect(prisma.bankCard.findUnique).toHaveBeenCalledWith({
        where: { cardNumberHash: expectedHash },
        select: { id: true, userId: true },
      })
      // 加密卡号入库
      expect(prisma.bankCard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cardNumber: 'enc_6222001234567890123',
          cardNumberHash: expectedHash,
          phone: 'enc_13800138000',
          isDefault: true, // 首张卡自动默认
        }),
      })
      // 返回脱敏卡号（不返回明文）
      expect(result.cardNumberMasked).toBe('6222****0123')
      expect(result.cardNumberLast4).toBe('0123')
      expect(result).not.toHaveProperty('cardNumber')
      expect(result).not.toHaveProperty('phone')
    })

    it('绑卡超过 10 张上限 → 400 KB219', async () => {
      prisma.bankCard.count.mockResolvedValue(10)
      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException)
      try {
        await service.create('u1', dto)
      } catch (e) {
        expect((e as BadRequestException).message).toContain(KBErrorCodes.BANKCARD_LIMIT_EXCEEDED)
      }
    })

    it('卡号已被自己绑定 → 409 KB218', async () => {
      prisma.bankCard.findUnique.mockResolvedValue({ id: 'b1', userId: 'u1' })
      await expect(service.create('u1', dto)).rejects.toThrow(ConflictException)
      try {
        await service.create('u1', dto)
      } catch (e) {
        expect((e as ConflictException).message).toContain(KBErrorCodes.BANKCARD_ALREADY_BOUND)
      }
    })

    it('卡号已被他人绑定 → 409 KB218（不泄露其他用户绑定情况）', async () => {
      prisma.bankCard.findUnique.mockResolvedValue({ id: 'b1', userId: 'other-user' })
      await expect(service.create('u1', dto)).rejects.toThrow(ConflictException)
    })

    it('设为默认时自动取消其他默认卡', async () => {
      prisma.bankCard.count.mockResolvedValue(2)
      prisma.bankCard.updateMany.mockResolvedValue({ count: 1 })
      prisma.bankCard.create.mockResolvedValue({
        id: 'b3',
        userId: 'u1',
        holderName: '张三',
        cardNumber: 'enc_6222001234567890123',
        bankName: '工商银行',
        branchName: null,
        phone: null,
        cardType: 'DEBIT',
        isDefault: true,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await service.create('u1', { ...dto, isDefault: true })

      expect(prisma.bankCard.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isDefault: true },
        data: { isDefault: false },
      })
    })
  })

  describe('findByUser 列表', () => {
    it('返回脱敏后的卡片列表', async () => {
      prisma.bankCard.findMany.mockResolvedValue([
        {
          id: 'b1',
          userId: 'u1',
          holderName: '张三',
          cardNumber: 'enc_6222001234567890123',
          bankName: '工商银行',
          branchName: null,
          phone: 'enc_13800138000',
          cardType: 'DEBIT',
          isDefault: true,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const result = await service.findByUser('u1')

      expect(result).toHaveLength(1)
      expect(result[0].cardNumberMasked).toBe('6222****0123')
      expect(result[0].phoneMasked).toBe('138****8000')
      expect(result[0]).not.toHaveProperty('cardNumber')
      expect(result[0]).not.toHaveProperty('phone')
    })
  })

  describe('remove 解绑', () => {
    it('解绑不存在的卡 → 404 KB217', async () => {
      prisma.bankCard.findUnique.mockResolvedValue(null)
      await expect(service.remove('u1', 'nonexistent')).rejects.toThrow(NotFoundException)
    })

    it('解绑别人的卡 → 404 KB217（不泄露存在性）', async () => {
      prisma.bankCard.findUnique.mockResolvedValue({
        id: 'b1',
        userId: 'other',
        isDefault: false,
      })
      await expect(service.remove('u1', 'b1')).rejects.toThrow(NotFoundException)
    })

    it('解绑默认卡 → 自动转移默认', async () => {
      prisma.bankCard.findUnique.mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        isDefault: true,
      })
      prisma.bankCard.findFirst.mockResolvedValue({
        id: 'b2',
        userId: 'u1',
        status: 'ACTIVE',
      })

      await service.remove('u1', 'b1')

      expect(prisma.bankCard.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: 'DELETED', isDefault: false },
      })
      expect(prisma.bankCard.update).toHaveBeenCalledWith({
        where: { id: 'b2' },
        data: { isDefault: true },
      })
    })
  })

  describe('findById 查询单张', () => {
    it('查询不存在的卡 → 404 KB217', async () => {
      prisma.bankCard.findUnique.mockResolvedValue(null)
      await expect(service.findById('u1', 'x')).rejects.toThrow(NotFoundException)
    })

    it('查询别人的卡 → 404 KB217', async () => {
      prisma.bankCard.findUnique.mockResolvedValue({ id: 'b1', userId: 'other', status: 'ACTIVE' })
      await expect(service.findById('u1', 'b1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('findDefault 默认卡', () => {
    it('无默认卡 → 返回 null', async () => {
      prisma.bankCard.findFirst.mockResolvedValue(null)
      const result = await service.findDefault('u1')
      expect(result).toBeNull()
    })

    it('有默认卡 → 返回脱敏卡 + 明文卡号（供提现使用）', async () => {
      prisma.bankCard.findFirst.mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        holderName: '张三',
        cardNumber: 'enc_6222001234567890123',
        bankName: '工商银行',
        branchName: null,
        phone: null,
        cardType: 'DEBIT',
        isDefault: true,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const result = await service.findDefault('u1')
      expect(result?.cardNumberPlain).toBe('6222001234567890123')
      expect(result?.cardNumberMasked).toBe('6222****0123')
    })
  })
})
