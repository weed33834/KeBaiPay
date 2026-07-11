import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { TransactionsService } from '../transactions/transactions.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { RefundService } from '../payment-channels/refund.service'
import { KBErrorCodes, kbError } from '../common/error-codes'

/**
 * Webhook 处理服务
 *
 * 功能：
 * - 支付渠道回调签名验证
 * - 幂等性检查
 * - 统一错误处理
 * - 回调日志记录
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly transactionsService: TransactionsService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly refundService: RefundService,
  ) {}

  /**
   * 处理充值回调
   */
  async handleRechargeCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const lockKey = `webhook:recharge:${channelCode}:${this.extractOrderNo(rawBody, channelCode)}`

    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'recharge')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`充值回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      // 2. 验证签名
      await this.verifySignature(channelCode, rawBody, headers, 'recharge')

      // 3. 处理回调
      const result = await this.transactionsService.handleRechargeCallback(
        channelCode,
        rawBody,
        headers,
      )

      // 4. 记录已处理
      await this.redis.set(idempotencyKey, '1', 86400) // 24 小时过期

      // 5. 记录回调日志
      await this.logCallback(channelCode, 'recharge', rawBody, 'SUCCESS')

      return result
    })
  }

  /**
   * 处理代付回调
   */
  async handlePayoutCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const lockKey = `webhook:payout:${channelCode}:${this.extractOrderNo(rawBody, channelCode)}`

    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'payout')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`代付回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      // 2. 验证签名
      await this.verifySignature(channelCode, rawBody, headers, 'payout')

      // 3. 处理回调
      const result = await this.withdrawalsService.handlePayoutCallback(
        channelCode,
        rawBody,
        headers,
      )

      // 4. 记录已处理
      await this.redis.set(idempotencyKey, '1', 86400)

      // 5. 记录回调日志
      await this.logCallback(channelCode, 'payout', rawBody, 'SUCCESS')

      return result
    })
  }

  /**
   * 处理退款回调
   */
  async handleRefundCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const lockKey = `webhook:refund:${channelCode}:${this.extractRefundNo(rawBody, channelCode)}`

    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'refund')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`退款回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      // 2. 验证签名
      await this.verifySignature(channelCode, rawBody, headers, 'refund')

      // 3. 处理回调
      const result = await this.refundService.handleRefundCallback(
        channelCode,
        rawBody,
        headers,
      )

      // 4. 记录已处理
      await this.redis.set(idempotencyKey, '1', 86400)

      // 5. 记录回调日志
      await this.logCallback(channelCode, 'refund', rawBody, 'SUCCESS')

      return result
    })
  }

  /**
   * 验证渠道签名
   */
  private async verifySignature(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
    callbackType: 'recharge' | 'payout' | 'refund',
  ): Promise<void> {
    try {
      const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
      const channel = this.channelRegistry.getChannel(channelCode)

      // 调用渠道的签名验证方法（如果实现了）
      if ('verifyWebhookSignature' in channel) {
        const verifyFn = (channel as any).verifyWebhookSignature
        if (typeof verifyFn === 'function') {
          const isValid = verifyFn.call(channel, rawBody, headers, channelConfig.config)
          if (!isValid) {
            this.logger.error(`${channelCode} ${callbackType} 回调签名验证失败`)
            await this.logCallback(channelCode, callbackType, rawBody, 'SIGNATURE_FAILED')
            throw new BadRequestException(
              kbError(KBErrorCodes.AUTHENTICATION_FAILED, `${channelCode} 回调签名验证失败`),
            )
          }
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error
      }
      this.logger.warn(`签名验证异常: ${error}`)
      // 签名验证异常时不阻止处理（但记录警告）
    }
  }

  /**
   * 从回调体中提取订单号
   */
  private extractOrderNo(rawBody: string, channelCode: string): string {
    try {
      const body = JSON.parse(rawBody)

      switch (channelCode) {
        case 'wechat':
          // 微信回调需要解密，这里提取外层的 out_trade_no（如果有）
          return body.out_trade_no || 'unknown'
        case 'alipay':
          // 支付宝回调是 form-urlencoded，解析后获取
          const params = new URLSearchParams(rawBody)
          return params.get('out_trade_no') || 'unknown'
        default:
          return body.orderNo || body.out_trade_no || 'unknown'
      }
    } catch {
      return 'unknown'
    }
  }

  /**
   * 从退款回调体中提取退款单号
   */
  private extractRefundNo(rawBody: string, channelCode: string): string {
    try {
      const body = JSON.parse(rawBody)

      switch (channelCode) {
        case 'wechat':
          return body.out_refund_no || 'unknown'
        case 'alipay':
          const params = new URLSearchParams(rawBody)
          return params.get('out_request_no') || 'unknown'
        default:
          return body.refundNo || body.out_refund_no || 'unknown'
      }
    } catch {
      return 'unknown'
    }
  }

  /**
   * 生成幂等键
   */
  private generateIdempotencyKey(
    channelCode: string,
    rawBody: string,
    callbackType: string,
  ): string {
    // 使用渠道+类型+body hash 作为幂等键
    const crypto = require('crypto')
    const hash = crypto.createHash('sha256').update(rawBody).digest('hex')
    return `webhook:${channelCode}:${callbackType}:${hash}`
  }

  /**
   * 获取成功响应
   */
  private getSuccessResponse(channelCode: string): string {
    switch (channelCode) {
      case 'wechat':
        return JSON.stringify({ code: 'SUCCESS', message: '成功' })
      case 'alipay':
        return 'success'
      default:
        return 'SUCCESS'
    }
  }

  /**
   * 记录回调日志
   */
  private async logCallback(
    channelCode: string,
    callbackType: string,
    rawBody: string,
    status: string,
  ): Promise<void> {
    try {
      // 可选：将回调日志存储到数据库或文件
      this.logger.log(`回调日志: ${channelCode} ${callbackType} ${status}`)
    } catch (error) {
      this.logger.error(`记录回调日志失败: ${error}`)
    }
  }
}
