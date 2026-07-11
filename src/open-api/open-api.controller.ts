import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger'
import { OpenApiGuard } from './open-api.guard'
import { OpenApiService } from './open-api.service'
import { CreateOpenApiOrderDto } from './dto/create-open-api-order.dto'
import { RefundDto } from './dto/refund.dto'
import { TransferDto } from './dto/transfer.dto'
import { OpenApiRequest } from './open-api.types'

@ApiTags('开放 API')
@ApiSecurity('app-id')
@Controller('open-api/v1')
export class OpenApiController {
  constructor(private readonly openApiService: OpenApiService) {}

  @UseGuards(OpenApiGuard)
  @Post('orders')
  @ApiOperation({
    summary: '创建收款订单',
    description: '商户创建收款订单，返回收银台链接供用户支付。需要 HMAC-SHA256 签名认证。',
  })
  @ApiResponse({ status: 201, description: '订单创建成功，返回 orderNo 和 cashierUrl' })
  @ApiResponse({ status: 401, description: 'KB401 签名验证失败' })
  @ApiResponse({ status: 403, description: 'KB717 应用已禁用' })
  createOrder(@Req() req: OpenApiRequest, @Body() dto: CreateOpenApiOrderDto) {
    return this.openApiService.createOrder(req.merchantApp!, dto)
  }

  @UseGuards(OpenApiGuard)
  @Get('orders/:orderNo')
  @ApiOperation({
    summary: '查询订单详情',
    description: '根据平台订单号查询订单状态和详情',
  })
  @ApiResponse({ status: 200, description: '返回订单详情' })
  @ApiResponse({ status: 404, description: 'KB603 订单不存在' })
  getOrder(@Req() req: OpenApiRequest, @Param('orderNo') orderNo: string) {
    return this.openApiService.getOrder(req.merchantApp!, orderNo)
  }

  @UseGuards(OpenApiGuard)
  @Post('refunds')
  @ApiOperation({
    summary: '申请退款',
    description: '对已支付订单发起全额或部分退款',
  })
  @ApiResponse({ status: 201, description: '退款成功' })
  @ApiResponse({ status: 400, description: 'KB713 订单不可退 / KB715 退款金额无效' })
  @ApiResponse({ status: 403, description: 'KB403 无权操作该订单' })
  refund(@Req() req: OpenApiRequest, @Body() dto: RefundDto) {
    return this.openApiService.refund(req.merchantApp!, dto)
  }

  @UseGuards(OpenApiGuard)
  @Post('transfers')
  @ApiOperation({
    summary: '商户转账',
    description: '商户向用户转账（商户余额扣款）',
  })
  @ApiResponse({ status: 201, description: '转账成功' })
  @ApiResponse({ status: 400, description: 'KB501 金额无效 / KB005 余额不足' })
  @ApiResponse({ status: 403, description: 'KB214 对方未实名 / 风控拦截' })
  transfer(@Req() req: OpenApiRequest, @Body() dto: TransferDto) {
    return this.openApiService.transfer(req.merchantApp!, dto)
  }

  @UseGuards(OpenApiGuard)
  @Get('balance')
  @ApiOperation({
    summary: '查询商户余额',
    description: '查询当前应用所属商户的账户余额',
  })
  @ApiResponse({ status: 200, description: '返回余额信息（单位：元）' })
  balance(@Req() req: OpenApiRequest) {
    return this.openApiService.balance(req.merchantApp!)
  }
}
