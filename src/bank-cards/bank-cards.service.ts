import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../crypto/crypto.service'
import { maskBankCard, maskPhone } from '../common/mask'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { CreateBankCardDto } from './dto/create-bank-card.dto'
import { UpdateBankCardDto } from './dto/update-bank-card.dto'

/** 单用户绑卡数量上限 */
const MAX_BANK_CARDS_PER_USER = 10

@Injectable()
export class BankCardsService {
  private readonly logger = new Logger(BankCardsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** 创建银行卡 */
  async create(userId: string, dto: CreateBankCardDto) {
    // 1. 数量上限校验
    const count = await this.prisma.bankCard.count({
      where: { userId, status: 'ACTIVE' },
    })
    if (count >= MAX_BANK_CARDS_PER_USER) {
      throw new BadRequestException(kbError(KBErrorCodes.BANKCARD_LIMIT_EXCEEDED))
    }

    // 2. 卡号哈希唯一校验（一张卡只能被一个用户绑定，防止盗卡多绑）
    const cardNumberHash = createHash('sha256').update(dto.cardNumber).digest('hex')
    const existing = await this.prisma.bankCard.findUnique({
      where: { cardNumberHash },
      select: { id: true, userId: true },
    })
    if (existing) {
      if (existing.userId === userId) {
        throw new ConflictException(kbError(KBErrorCodes.BANKCARD_ALREADY_BOUND))
      } else {
        // 该卡已被他人绑定，为了不泄露其他用户绑定情况，统一返回相同错误码
        throw new ConflictException(kbError(KBErrorCodes.BANKCARD_ALREADY_BOUND))
      }
    }

    // 3. 加密卡号 / 手机号入库
    const encryptedCardNumber = this.crypto.encrypt(dto.cardNumber)
    const encryptedPhone = dto.phone ? this.crypto.encrypt(dto.phone) : null
    const phoneHash = dto.phone
      ? createHash('sha256').update(dto.phone).digest('hex')
      : null

    // 4. 若设为默认，先把其他卡默认取消
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.bankCard.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        })
      }
      const card = await tx.bankCard.create({
        data: {
          userId,
          holderName: dto.holderName,
          cardNumber: encryptedCardNumber,
          cardNumberHash,
          bankName: dto.bankName,
          branchName: dto.branchName,
          phone: encryptedPhone,
          phoneHash,
          cardType: dto.cardType ?? 'DEBIT',
          isDefault: dto.isDefault ?? count === 0, // 首张卡自动设为默认
          status: 'ACTIVE',
        },
      })
      this.logger.log(`用户 ${userId} 绑卡成功 cardId=${card.id}`)
      return this.toDto(card)
    })
  }

  /** 列出当前用户的银行卡 */
  async findByUser(userId: string) {
    const cards = await this.prisma.bankCard.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })
    return cards.map((c) => this.toDto(c))
  }

  /** 查询单张（用于提现时校验归属） */
  async findById(userId: string, id: string) {
    const card = await this.prisma.bankCard.findUnique({ where: { id } })
    if (!card || card.userId !== userId || card.status !== 'ACTIVE') {
      throw new NotFoundException(kbError(KBErrorCodes.BANKCARD_NOT_FOUND))
    }
    return this.toDto(card)
  }

  /** 更新银行卡资料（不允许改卡号） */
  async update(userId: string, id: string, dto: UpdateBankCardDto) {
    const card = await this.prisma.bankCard.findUnique({ where: { id } })
    if (!card || card.userId !== userId || card.status !== 'ACTIVE') {
      throw new NotFoundException(kbError(KBErrorCodes.BANKCARD_NOT_FOUND))
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.bankCard.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        })
      }
      const updated = await tx.bankCard.update({
        where: { id },
        data: {
          holderName: dto.holderName,
          bankName: dto.bankName,
          branchName: dto.branchName,
          cardType: dto.cardType,
          isDefault: dto.isDefault,
        },
      })
      return this.toDto(updated)
    })
  }

  /** 软删除：标记 DELETED，不真正删除以便审计 */
  async remove(userId: string, id: string) {
    const card = await this.prisma.bankCard.findUnique({ where: { id } })
    if (!card || card.userId !== userId) {
      throw new NotFoundException(kbError(KBErrorCodes.BANKCARD_NOT_FOUND))
    }
    await this.prisma.bankCard.update({
      where: { id },
      data: { status: 'DELETED', isDefault: false },
    })
    // 若删除的是默认卡，自动把最近一张设为默认
    if (card.isDefault) {
      const next = await this.prisma.bankCard.findFirst({
        where: { userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })
      if (next) {
        await this.prisma.bankCard.update({
          where: { id: next.id },
          data: { isDefault: true },
        })
      }
    }
    this.logger.log(`用户 ${userId} 解绑卡 id=${id}`)
    return { success: true }
  }

  /** 取默认卡（提现时使用） */
  async findDefault(userId: string) {
    const card = await this.prisma.bankCard.findFirst({
      where: { userId, status: 'ACTIVE', isDefault: true },
    })
    if (!card) return null
    return {
      ...this.toDto(card),
      // 提现服务需要明文卡号
      cardNumberPlain: this.crypto.decrypt(card.cardNumber),
    }
  }

  /** 转换为对外 DTO：脱敏卡号、手机号 */
  private toDto(card: {
    id: string
    userId: string
    holderName: string
    cardNumber: string
    bankName: string
    branchName: string | null
    phone: string | null
    cardType: string
    isDefault: boolean
    status: string
    createdAt: Date
    updatedAt: Date
  }) {
    let maskedPhone: string | null = null
    if (card.phone) {
      try {
        maskedPhone = maskPhone(this.crypto.decrypt(card.phone))
      } catch {
        // phone 字段历史上可能未加密，直接脱敏
        maskedPhone = maskPhone(card.phone)
      }
    }
    return {
      id: card.id,
      holderName: card.holderName,
      // 永远只返回脱敏后的卡号
      cardNumberMasked: maskBankCard(this.crypto.decrypt(card.cardNumber)),
      // 末四位方便前端展示
      cardNumberLast4: this.crypto.decrypt(card.cardNumber).slice(-4),
      bankName: card.bankName,
      branchName: card.branchName,
      phoneMasked: maskedPhone,
      cardType: card.cardType,
      isDefault: card.isDefault,
      status: card.status,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    }
  }
}
