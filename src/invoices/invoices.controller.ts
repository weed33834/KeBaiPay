import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { PrismaService } from '../prisma/prisma.service'
import { InvoicesService } from './invoices.service'
import { CreateInvoiceDto, ListInvoiceDto } from './dto/invoice.dto'
import { MerchantStatus } from '../common/enums'
import { NotFoundException } from '@nestjs/common'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'

@ApiTags('商户发票 Invoice')
@ApiBearerAuth('user-auth')
@Controller()
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly prisma: PrismaService,
  ) {}

  /** 根据 user_id 查询 merchant_id */
  private async getMerchantId(userId: string): Promise<string> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) {
      throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    }
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    }
    return merchant.id
  }

  // ============== 商户端 ==============

  @UseGuards(JwtAuthGuard)
  @Post('invoices')
  @ApiOperation({ summary: '商户申请发票' })
  async create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateInvoiceDto,
  ) {
    const merchantId = await this.getMerchantId(user.id)
    return this.invoicesService.createInvoice(merchantId, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('invoices')
  @ApiOperation({ summary: '商户查询自己的发票列表' })
  async list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListInvoiceDto,
  ) {
    const merchantId = await this.getMerchantId(user.id)
    return this.invoicesService.listByMerchant(merchantId, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get('invoices/:invoiceNo')
  @ApiOperation({ summary: '查询发票详情' })
  async findByInvoiceNo(
    @CurrentUser() user: CurrentUserType,
    @Param('invoiceNo') invoiceNo: string,
  ) {
    const merchantId = await this.getMerchantId(user.id)
    return this.invoicesService.findByInvoiceNo(invoiceNo, merchantId)
  }

  @UseGuards(JwtAuthGuard)
  @Post('invoices/:invoiceNo/cancel')
  @ApiOperation({ summary: '商户作废自己的发票（仅 PENDING 状态）' })
  async cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('invoiceNo') invoiceNo: string,
  ) {
    const merchantId = await this.getMerchantId(user.id)
    return this.invoicesService.cancelByMerchant(merchantId, invoiceNo)
  }

  // ============== 管理端 ==============

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/invoices')
  @ApiOperation({ summary: '管理员查询所有发票列表' })
  async adminList(@Query() query: ListInvoiceDto) {
    return this.invoicesService.listAll(query)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/invoices/:invoiceNo')
  @ApiOperation({ summary: '管理员查询发票详情' })
  async adminFindByInvoiceNo(@Param('invoiceNo') invoiceNo: string) {
    return this.invoicesService.findByInvoiceNo(invoiceNo)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('merchant:audit')
  @Post('admin/invoices/:invoiceNo/issue')
  @ApiOperation({ summary: '管理员开具发票' })
  async adminIssue(@Param('invoiceNo') invoiceNo: string) {
    return this.invoicesService.issue(invoiceNo)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('merchant:audit')
  @Post('admin/invoices/:invoiceNo/cancel')
  @ApiOperation({ summary: '管理员作废发票' })
  async adminCancel(@Param('invoiceNo') invoiceNo: string) {
    return this.invoicesService.cancel(invoiceNo)
  }
}
