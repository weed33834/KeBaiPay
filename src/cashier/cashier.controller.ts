import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { CashierService } from './cashier.service'
import { CreateCashierOrderDto } from './dto/create-cashier-order.dto'
import { PayCashierOrderDto } from './dto/pay-cashier-order.dto'
import { ListMyOrdersQueryDto } from './dto/list-my-orders-query.dto'
import { ExportOrdersQueryDto } from './dto/export-orders-query.dto'
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto'

@ApiTags('收银台')
@ApiBearerAuth('user-auth')
@Controller('cashier/orders')
export class CashierController {
  constructor(private readonly cashierService: CashierService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '创建收银台订单', description: '用户发起向商户的付款订单' })
  @ApiResponse({ status: 201, description: '订单创建成功' })
  @ApiResponse({ status: 400, description: 'KB601 商户订单号已存在' })
  createOrder(@CurrentUser() user: CurrentUserType, @Body() dto: CreateCashierOrderDto) {
    return this.cashierService.createOrder(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '查询我的收银台订单', description: '分页查询当前用户的收银台订单' })
  @ApiResponse({ status: 200, description: '返回订单列表' })
  listMyOrders(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListMyOrdersQueryDto,
  ) {
    return this.cashierService.listMyOrders(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get('export')
  @ApiOperation({ summary: '导出订单 CSV', description: '导出当前用户的订单为 CSV 文件' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportMyOrders(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ExportOrdersQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.cashierService.exportMyOrders(user.id, query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="orders.csv"',
    )
    res.send(csv)
  }

  @UseGuards(JwtAuthGuard)
  @Get('reconciliation')
  @ApiOperation({ summary: '对账查询', description: '查询指定日期范围的对账数据' })
  @ApiResponse({ status: 200, description: '返回对账数据' })
  reconciliation(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ReconciliationQueryDto,
  ) {
    return this.cashierService.reconciliation(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':orderNo')
  @ApiOperation({ summary: '查询订单详情' })
  @ApiResponse({ status: 200, description: '返回订单详情' })
  @ApiResponse({ status: 404, description: 'KB603 订单不存在' })
  getOrder(@Param('orderNo') orderNo: string) {
    return this.cashierService.getOrder(orderNo)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':orderNo/pay')
  @ApiOperation({ summary: '支付订单', description: '用户使用余额支付收银台订单' })
  @ApiResponse({ status: 200, description: '支付成功' })
  @ApiResponse({ status: 400, description: 'KB208 支付密码错误 / KB005 余额不足' })
  pay(
    @CurrentUser() user: CurrentUserType,
    @Param('orderNo') orderNo: string,
    @Body() dto: PayCashierOrderDto,
  ) {
    return this.cashierService.pay(user.id, {
      orderNo,
      payPassword: dto.payPassword,
    })
  }

  @UseGuards(JwtAuthGuard)
  @Post(':orderNo/notify')
  @ApiOperation({ summary: '重试回调通知', description: '手动触发商户回调通知' })
  @ApiResponse({ status: 200, description: '通知已发送' })
  retryNotify(
    @CurrentUser() user: CurrentUserType,
    @Param('orderNo') orderNo: string,
  ) {
    return this.cashierService.retryNotify(user.id, orderNo)
  }
}

@ApiTags('收银台')
@Controller('cashier')
export class CashierQrCodeController {
  constructor(private readonly cashierService: CashierService) {}

  @Get('qrcode/:code')
  @ApiOperation({ summary: '扫码获取收款信息', description: '扫描商户收款码获取订单信息（无需登录）' })
  @ApiResponse({ status: 200, description: '返回收款码关联的订单信息' })
  @ApiResponse({ status: 404, description: 'KB610 收款码无效' })
  getQrCodeOrderInfo(@Param('code') code: string) {
    return this.cashierService.getQrCodeOrderInfo(code)
  }
}
