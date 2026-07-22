import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  InvoiceType,
  InvoiceStatus,
  MerchantStatus,
} from '../common/enums'
import { generateOrderNo } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { CreateInvoiceDto, ListInvoiceDto } from './dto/invoice.dto'

/**
 * 商户发票服务
 *
 * 资金流：
 *  1. 商户创建发票申请（PENDING）
 *  2. 管理员审核开具（ISSUED）或作废（CANCELLED）
 *  3. 商户可查看自己的发票列表和详情
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** 商户申请发票 */
  async createInvoice(merchantId: string, dto: CreateInvoiceDto) {
    // 校验商户
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    })
    if (!merchant) {
      throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    }
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    // 校验金额
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVOICE_AMOUNT_INVALID))
    }

    // 专用发票必须有税号
    if (dto.type === InvoiceType.SPECIAL && !dto.taxNo) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '专用发票必须提供税号'))
    }

    const invoiceNo = generateOrderNo('INV')
    return this.prisma.invoice.create({
      data: {
        invoiceNo,
        merchantId,
        type: dto.type,
        title: dto.title,
        taxNo: dto.taxNo,
        bankName: dto.bankName,
        bankAccount: dto.bankAccount,
        address: dto.address,
        phone: dto.phone,
        amount: dto.amount,
        status: InvoiceStatus.PENDING,
        remark: dto.remark,
      },
    })
  }

  /** 查询发票详情 */
  async findByInvoiceNo(invoiceNo: string, merchantId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { invoiceNo },
      include: { merchant: true },
    })
    if (!invoice) {
      throw new NotFoundException(kbError(KBErrorCodes.INVOICE_NOT_FOUND))
    }
    // 权限校验：商户只能看自己的发票
    if (merchantId && invoice.merchantId !== merchantId) {
      throw new ForbiddenException(kbError(KBErrorCodes.INVOICE_MERCHANT_MISMATCH))
    }
    return invoice
  }

  /** 商户查询自己的发票列表 */
  async listByMerchant(merchantId: string, query: ListInvoiceDto) {
    const where: Prisma.InvoiceWhereInput = { merchantId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 管理员查询所有发票 */
  async listAll(query: ListInvoiceDto) {
    const where: Prisma.InvoiceWhereInput = {}
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { merchant: true },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 管理员开具发票 */
  async issue(invoiceNo: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { invoiceNo },
    })
    if (!invoice) {
      throw new NotFoundException(kbError(KBErrorCodes.INVOICE_NOT_FOUND))
    }
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.INVOICE_STATUS_INVALID))
    }
    // 乐观锁：仅 PENDING → ISSUED
    const result = await this.prisma.invoice.updateMany({
      where: { id: invoice.id, status: InvoiceStatus.PENDING },
      data: {
        status: InvoiceStatus.ISSUED,
        issueDate: new Date(),
      },
    })
    if (result.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVOICE_STATUS_INVALID))
    }
    return this.prisma.invoice.findUnique({ where: { id: invoice.id } })
  }

  /** 作废发票（仅 PENDING/ISSUED 可作废） */
  async cancel(invoiceNo: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { invoiceNo },
    })
    if (!invoice) {
      throw new NotFoundException(kbError(KBErrorCodes.INVOICE_NOT_FOUND))
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(kbError(KBErrorCodes.INVOICE_STATUS_INVALID))
    }
    // 乐观锁：非 CANCELLED → CANCELLED
    const result = await this.prisma.invoice.updateMany({
      where: { id: invoice.id, status: { not: InvoiceStatus.CANCELLED } },
      data: { status: InvoiceStatus.CANCELLED },
    })
    if (result.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVOICE_STATUS_INVALID))
    }
    return this.prisma.invoice.findUnique({ where: { id: invoice.id } })
  }

  /** 商户作废自己的发票（仅 PENDING 状态） */
  async cancelByMerchant(merchantId: string, invoiceNo: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { invoiceNo },
    })
    if (!invoice) {
      throw new NotFoundException(kbError(KBErrorCodes.INVOICE_NOT_FOUND))
    }
    if (invoice.merchantId !== merchantId) {
      throw new ForbiddenException(kbError(KBErrorCodes.INVOICE_MERCHANT_MISMATCH))
    }
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.INVOICE_STATUS_INVALID))
    }
    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.CANCELLED },
    })
  }
}
