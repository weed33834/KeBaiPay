import { Injectable } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import {
  PaymentChannel,
  RechargeRequest,
  RechargeResponse,
  RechargeCallbackResult,
  PayoutRequest,
  PayoutResponse,
  PayoutQueryResult,
  RefundRequest,
  RefundResponse,
  RefundQueryResult,
  RefundCallbackResult,
  OrderQueryResult,
  ChannelConfig,
} from '../payment-channel.interface'
import { KBErrorCodes, kbError } from '../../common/error-codes'

/**
 * Mock 渠道：用于开发和测试环境
 *
 * 模拟真实渠道的异步支付流程：
 * - createRecharge 返回 PENDING 状态和支付链接
 * - 回调通过 HMAC-SHA256 签名校验
 * - createPayout 返回 PROCESSING 状态
 * - queryPayout 根据金额决定成功/失败（金额尾数为 1 的模拟失败）
 * - refund 支持退款流程模拟
 */
@Injectable()
export class MockChannel implements PaymentChannel {
  readonly code = 'mock'
  readonly name = '模拟渠道'

  // 从环境变量读取：避免源码硬编码 secret 导致测试环境与生产环境共用同一密钥
  // 未配置时使用 dev 专用默认值。生产环境通过 PaymentChannelRegistry.getChannel
  // 拦截 mock 渠道调用（isProduction && code === 'mock' 时抛 NotFoundException）
  private readonly secret = process.env.MOCK_CHANNEL_SECRET || 'mock-channel-secret-dev-only'

  sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('hex')
  }

  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    _channelConfig: ChannelConfig,
  ): boolean {
    let body: { orderNo: string; channelOrderNo: string; amount: string | number }
    try {
      body = JSON.parse(rawBody)
    } catch {
      return false
    }
    const expectedSig = this.sign(`${body.orderNo}${body.channelOrderNo}${body.amount}`)
    return this.safeCompare(headers['x-signature'] || '', expectedSig)
  }

  async createRecharge(params: RechargeRequest): Promise<RechargeResponse> {
    const channelOrderNo = `MOCK_R_${params.orderNo}`
    return {
      channelOrderNo,
      payUrl: `https://mock-pay.example.com/pay?order=${channelOrderNo}&amount=${params.amount}`,
      status: 'PENDING',
    }
  }

  async queryOrder(
    channelOrderNo: string,
    _channelConfig: ChannelConfig,
  ): Promise<OrderQueryResult> {
    const lastChar = channelOrderNo.slice(-1)
    return {
      channelOrderNo,
      status: lastChar === '1' ? 'FAILED' : 'SUCCESS',
      totalAmount: 100,
      message: '模拟订单查询',
    }
  }

  parseRechargeCallback(
    rawBody: string,
    headers: Record<string, string>,
    _channelConfig: ChannelConfig,
  ): RechargeCallbackResult {
    let body: { orderNo: string; channelOrderNo: string; amount: string | number; status: string }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '回调 body 非 JSON 格式'))
    }
    const expectedSig = this.sign(`${body.orderNo}${body.channelOrderNo}${body.amount}`)
    if (!this.safeCompare(headers['x-signature'] || '', expectedSig)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, 'Mock 渠道签名校验失败'))
    }
    return {
      channelOrderNo: body.channelOrderNo,
      orderNo: body.orderNo,
      amount: Number(body.amount),
      status: body.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      signature: headers['x-signature'],
    }
  }

  buildRechargeCallbackSuccess(): string {
    return 'SUCCESS'
  }

  async refund(params: RefundRequest): Promise<RefundResponse> {
    const channelRefundNo = `MOCK_RF_${params.refundNo}`
    return {
      channelRefundNo,
      status: 'PENDING',
      message: '模拟退款受理中',
    }
  }

  async queryRefund(
    channelRefundNo: string,
    _channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult> {
    const lastChar = channelRefundNo.slice(-1)
    return {
      channelRefundNo,
      status: lastChar === '1' ? 'FAILED' : 'SUCCESS',
      message: '模拟退款查询',
    }
  }

  parseRefundCallback(
    rawBody: string,
    headers: Record<string, string>,
    _channelConfig: ChannelConfig,
  ): RefundCallbackResult {
    let body: { orderNo: string; refundNo: string; channelRefundNo: string; amount: string | number; status: string }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '退款回调 body 非 JSON 格式'))
    }
    const expectedSig = this.sign(`${body.orderNo}${body.refundNo}${body.amount}`)
    if (!this.safeCompare(headers['x-signature'] || '', expectedSig)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, 'Mock 渠道退款回调签名校验失败'))
    }
    return {
      channelRefundNo: body.channelRefundNo,
      orderNo: body.orderNo,
      refundNo: body.refundNo,
      amount: Number(body.amount),
      status: body.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      signature: headers['x-signature'],
    }
  }

  buildRefundCallbackSuccess(): string {
    return 'SUCCESS'
  }

  async createPayout(params: PayoutRequest): Promise<PayoutResponse> {
    const channelOrderNo = `MOCK_P_${params.orderNo}`
    return {
      channelOrderNo,
      status: 'PROCESSING',
      message: '代付受理中',
    }
  }

  async queryPayout(
    channelOrderNo: string,
    _channelConfig: ChannelConfig,
  ): Promise<PayoutQueryResult> {
    const lastChar = channelOrderNo.slice(-1)
    if (lastChar === '1') {
      return { channelOrderNo, status: 'FAILED', message: '模拟代付失败' }
    }
    return { channelOrderNo, status: 'SUCCESS', message: '代付成功' }
  }

  parsePayoutCallback(
    rawBody: string,
    headers: Record<string, string>,
    _channelConfig: ChannelConfig,
  ): {
    channelOrderNo: string
    orderNo: string
    status: 'SUCCESS' | 'FAILED'
    signature: string
  } {
    let body: { orderNo: string; channelOrderNo: string; status: string }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '代付回调 body 非 JSON 格式'))
    }
    const expectedSig = this.sign(`${body.orderNo}${body.channelOrderNo}${body.status}`)
    if (!this.safeCompare(headers['x-signature'] || '', expectedSig)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, 'Mock 渠道代付回调签名校验失败'))
    }
    return {
      channelOrderNo: body.channelOrderNo,
      orderNo: body.orderNo,
      status: body.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
      signature: headers['x-signature'],
    }
  }

  buildPayoutCallbackSuccess(): string {
    return 'SUCCESS'
  }
}
