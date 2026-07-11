import { Body, Controller, Headers, Param, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { Request } from 'express'
import { WebhooksService } from './webhooks.service'
import { WebhookBodyDto } from './dto/webhook-body.dto'

type RawBodyRequest = Request & {
  rawBody?: Buffer | string
}

@ApiTags('Webhooks')
@Controller('webhooks')
@UsePipes(
  new ValidationPipe({
    whitelist: false,
    transform: true,
  }),
)
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
  ) {}

  @Post('recharge/:channel')
  @ApiOperation({ summary: '充值回调', description: '支付渠道回调通知（由渠道服务器调用）' })
  @ApiResponse({ status: 200, description: '处理成功' })
  async rechargeCallback(
    @Param('channel') channel: string,
    @Body() body: WebhookBodyDto,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest,
  ) {
    const rawBody =
      typeof body === 'string' ? body : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(body)
    const result = await this.webhooksService.handleRechargeCallback(channel, rawBody, headers)
    return result
  }

  @Post('payout/:channel')
  @ApiOperation({ summary: '代付回调', description: '代付渠道回调通知' })
  @ApiResponse({ status: 200, description: '处理成功' })
  async payoutCallback(
    @Param('channel') channel: string,
    @Body() body: WebhookBodyDto,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest,
  ) {
    const rawBody =
      typeof body === 'string' ? body : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(body)
    const result = await this.webhooksService.handlePayoutCallback(channel, rawBody, headers)
    return result
  }

  @Post('refund/:channel')
  @ApiOperation({ summary: '退款回调', description: '退款渠道回调通知' })
  @ApiResponse({ status: 200, description: '处理成功' })
  async refundCallback(
    @Param('channel') channel: string,
    @Body() body: WebhookBodyDto,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest,
  ) {
    const rawBody =
      typeof body === 'string' ? body : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(body)
    const result = await this.webhooksService.handleRefundCallback(channel, rawBody, headers)
    return result
  }
}
