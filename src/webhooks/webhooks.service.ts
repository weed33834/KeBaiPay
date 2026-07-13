import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { TransactionsService } from '../transactions/transactions.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { RefundService } from '../payment-channels/refund.service'
import { KBErrorCodes, kbError } from '../common/error-codes'
import type { ChannelConfig } from '../payment-channels/payment-channel.interface'

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
    // 锁 key 使用 rawBody hash：微信 V3 回调外层无 out_trade_no（需解密），
    // 改用 hash 保证同一回调内容多次重试时锁同一把，避免锁 key 退化为 unknown
    const orderNo = this.extractOrderNo(rawBody, channelCode)
    const lockKey = `webhook:recharge:${channelCode}:${orderNo}`

    const startTime = Date.now()
    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'recharge')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`充值回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      try {
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

        // 5. 记录回调日志（落库）
        await this.logCallback(
          channelCode,
          'recharge',
          rawBody,
          'SUCCESS',
          null,
          Date.now() - startTime,
        )

        return result
      } catch (err) {
        // 处理失败也要落库记录，便于审计追溯
        await this.logCallback(
          channelCode,
          'recharge',
          rawBody,
          'PROCESS_ERROR',
          err instanceof Error ? err.message : String(err),
          Date.now() - startTime,
        )
        throw err
      }
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
    const orderNo = this.extractOrderNo(rawBody, channelCode)
    const lockKey = `webhook:payout:${channelCode}:${orderNo}`

    const startTime = Date.now()
    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'payout')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`代付回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      try {
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

        // 5. 记录回调日志（落库）
        await this.logCallback(
          channelCode,
          'payout',
          rawBody,
          'SUCCESS',
          null,
          Date.now() - startTime,
        )

        return result
      } catch (err) {
        await this.logCallback(
          channelCode,
          'payout',
          rawBody,
          'PROCESS_ERROR',
          err instanceof Error ? err.message : String(err),
          Date.now() - startTime,
        )
        throw err
      }
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
    const refundNo = this.extractRefundNo(rawBody, channelCode)
    const lockKey = `webhook:refund:${channelCode}:${refundNo}`

    const startTime = Date.now()
    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'refund')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`退款回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      try {
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

        // 5. 记录回调日志（落库）
        await this.logCallback(
          channelCode,
          'refund',
          rawBody,
          'SUCCESS',
          null,
          Date.now() - startTime,
        )

        return result
      } catch (err) {
        await this.logCallback(
          channelCode,
          'refund',
          rawBody,
          'PROCESS_ERROR',
          err instanceof Error ? err.message : String(err),
          Date.now() - startTime,
        )
        throw err
      }
    })
  }

  /**
   * 验证渠道签名
   * 签名验证失败或异常一律拒绝处理，防止伪造回调
   */
  private async verifySignature(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
    callbackType: 'recharge' | 'payout' | 'refund',
  ): Promise<void> {
    const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    const channel = this.channelRegistry.getChannel(channelCode)

    // 调用渠道的签名验证方法（如果实现了）
    if ('verifyWebhookSignature' in channel) {
      const verifyFn = (channel as { verifyWebhookSignature?: (raw: string, hdr: Record<string, string>, cfg: ChannelConfig) => boolean }).verifyWebhookSignature
      if (typeof verifyFn === 'function') {
        let isValid = false
        try {
          isValid = verifyFn.call(channel, rawBody, headers, channelConfig.config)
        } catch (err) {
          // 验签过程本身抛错视为验签失败，拒绝处理
          this.logger.error(`${channelCode} ${callbackType} 验签异常: ${err}`)
          await this.logCallback(
            channelCode,
            callbackType,
            rawBody,
            'SIGNATURE_ERROR',
            err instanceof Error ? err.message : String(err),
            0,
          )
          throw new BadRequestException(
            kbError(KBErrorCodes.AUTHENTICATION_FAILED, `${channelCode} 回调验签异常`),
          )
        }
        if (!isValid) {
          this.logger.error(`${channelCode} ${callbackType} 回调签名验证失败`)
          await this.logCallback(
            channelCode,
            callbackType,
            rawBody,
            'SIGNATURE_FAILED',
            'signature verification failed',
            0,
          )
          throw new BadRequestException(
            kbError(KBErrorCodes.AUTHENTICATION_FAILED, `${channelCode} 回调签名验证失败`),
          )
        }
      }
    }
  }

  /**
   * 从回调体中提取订单号（用于锁 key 隔离）
   *
   * 微信 V3 回调外层是加密的 resource.ciphertext，无法在解密前提取 out_trade_no。
   * 改用 rawBody 的 SHA256 前 16 位作为锁 key 后缀，保证同一回调内容多次重试时
   * 锁同一把，不同回调锁不同把。比之前退化为 'unknown' 让所有并发回调串行化更优。
   *
   * 支付宝和其他渠道能直接解析出 out_trade_no，仍优先使用业务订单号。
   */
  private extractOrderNo(rawBody: string, channelCode: string): string {
    // 微信 V3 回调外层无明文订单号，用 hash 兜底
    if (channelCode === 'wechat') {
      const hash = createHash('sha256').update(rawBody).digest('hex')
      return `hash:${hash.slice(0, 16)}`
    }

    try {
      if (channelCode === 'alipay') {
        // 支付宝回调是 form-urlencoded
        const params = new URLSearchParams(rawBody)
        return params.get('out_trade_no') || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
      }
      const body = JSON.parse(rawBody)
      return body.orderNo || body.out_trade_no || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    } catch {
      // 解析失败用 hash 兜底，避免退化为 'unknown' 导致并发回调串行化
      return `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    }
  }

  /**
   * 从退款回调体中提取退款单号（用于锁 key 隔离）
   *
   * 与 extractOrderNo 同理：微信回调用 hash 兜底。
   */
  private extractRefundNo(rawBody: string, channelCode: string): string {
    if (channelCode === 'wechat') {
      const hash = createHash('sha256').update(rawBody).digest('hex')
      return `hash:${hash.slice(0, 16)}`
    }

    try {
      if (channelCode === 'alipay') {
        const params = new URLSearchParams(rawBody)
        return params.get('out_request_no') || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
      }
      const body = JSON.parse(rawBody)
      return body.refundNo || body.out_refund_no || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    } catch {
      return `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
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
    const hash = createHash('sha256').update(rawBody).digest('hex')
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
   * 记录回调日志（落库到 webhook_logs 表）
   *
   * 所有 webhook 入站均落库，包含成功/失败两种状态，用于审计追溯与故障排查。
   * 落库失败不影响主流程，仅记录错误日志。
   */
  private async logCallback(
    channelCode: string,
    callbackType: string,
    rawBody: string,
    status: string,
    errorMessage: string | null,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.prisma.webhookLog.create({
        data: {
          channelCode,
          callbackType,
          status,
          rawBody,
          errorMessage,
          durationMs,
        },
      })
    } catch (error) {
      // 落库失败不能影响主流程，仅记录错误日志
      this.logger.error(
        `记录回调日志失败: ${channelCode} ${callbackType} ${status} - ${error}`,
      )
    }
  }
}
