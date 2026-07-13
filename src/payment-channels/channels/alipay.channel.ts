import { Injectable, Logger } from '@nestjs/common'
import { createSign, createVerify } from 'crypto'
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
 * 支付宝支付渠道适配器
 *
 * 支持支付方式：
 *   page - 电脑网站支付 (alipay.trade.page.pay)
 *   wap  - 手机网站支付 (alipay.trade.wap.pay)
 *
 * 配置字段 (存储在 PaymentChannelConfig.config JSON 中):
 *   appId       - 支付宝应用ID
 *   privateKey  - 应用私钥 (PEM字符串，PKCS8格式)
 *   alipayPublicKey - 支付宝公钥
 *   notifyUrl   - 异步通知地址
 *   returnUrl   - 同步跳转地址(电脑网站支付)
 *   signType    - 签名类型 (RSA2)
 */
@Injectable()
export class AlipayChannel implements PaymentChannel {
  readonly code = 'alipay'
  readonly name = '支付宝'
  private readonly logger = new Logger(AlipayChannel.name)

  private readonly ALIPAY_GATEWAY = 'https://openapi.alipay.com/gateway.do'
  private readonly ALIPAY_GATEWAY_DEV = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'

  /**
   * 构建公共请求参数
   */
  private buildCommonParams(appId: string, method: string, signType = 'RSA2'): Record<string, string> {
    return {
      app_id: appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: signType,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      version: '1.0',
    }
  }

  /**
   * RSA2 签名
   */
  private signRsa2(params: Record<string, string>, privateKey: string): string {
    const sortedKeys = Object.keys(params)
      .filter(k => k !== 'sign' && params[k] !== '' && params[k] !== undefined)
      .sort()

    const signStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&')

    const sign = createSign('RSA-SHA256')
    sign.update(signStr)
    return sign.sign(privateKey, 'base64')
  }

  /**
   * 验证 RSA2 签名
   */
  private verifyRsa2(signContent: string, signature: string, publicKey: string): boolean {
    const verify = createVerify('RSA-SHA256')
    verify.update(signContent)
    return verify.verify(publicKey, signature, 'base64')
  }

  /**
   * 支付宝通知验签
   */
  private verifyNotify(params: Record<string, string>, alipayPublicKey: string): boolean {
    const sign = params.sign
    if (!sign) return false

    const sortedKeys = Object.keys(params)
      .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
      .sort()

    const signContent = sortedKeys.map(k => `${k}=${params[k]}`).join('&')

    return this.verifyRsa2(signContent, sign, alipayPublicKey)
  }

  /**
   * 构建支付请求（page 或 wap）
   */
  private buildPayRequest(
    params: RechargeRequest,
    payMethod: 'page' | 'wap',
  ): { payUrl: string; channelOrderNo: string } {
    const cfg = params.channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string
    const notifyUrl = (cfg.notifyUrl as string) || params.notifyUrl
    const returnUrl = (cfg.returnUrl as string) || ''

    if (!appId || !privateKey) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '支付宝配置不完整：缺少 appId/privateKey'))
    }

    const productCode = payMethod === 'page' ? 'FAST_INSTANT_TRADE_PAY' : 'QUICK_WAP_WAY'
    const method = payMethod === 'page' ? 'alipay.trade.page.pay' : 'alipay.trade.wap.pay'

    const bizContent = JSON.stringify({
      out_trade_no: params.orderNo,
      total_amount: (params.amount / 100).toFixed(2),
      subject: params.subject,
      product_code: productCode,
    })

    const commonParams = this.buildCommonParams(appId, method)
    const bizParams: Record<string, string> = { ...commonParams, biz_content: bizContent, notify_url: notifyUrl }
    if (returnUrl) bizParams.return_url = returnUrl

    const sign = this.signRsa2(bizParams, privateKey)
    const allParams = { ...bizParams, sign }

    const queryString = Object.entries(allParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    return {
      payUrl: `${this.ALIPAY_GATEWAY}?${queryString}`,
      channelOrderNo: params.orderNo,
    }
  }

  /**
   * 验证回调签名（公开方法供 webhook 使用）
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): boolean {
    const alipayPublicKey = channelConfig.alipayPublicKey as string
    if (!alipayPublicKey) {
      this.logger.error('支付宝公钥未配置，拒绝回调签名验证')
      return false
    }

    const params: Record<string, string> = {}
    const searchParams = new URLSearchParams(rawBody)
    searchParams.forEach((value, key) => {
      params[key] = value
    })

    return this.verifyNotify(params, alipayPublicKey)
  }

  async createRecharge(params: RechargeRequest): Promise<RechargeResponse> {
    const payMethod = (params.payMethod as 'page' | 'wap') || 'wap'
    const { payUrl, channelOrderNo } = this.buildPayRequest(params, payMethod)

    return {
      channelOrderNo,
      payUrl,
      payParams: { pay_url: payUrl } as ChannelConfig,
      status: 'PENDING',
    }
  }

  /**
   * 查询支付订单状态
   */
  async queryOrder(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<OrderQueryResult> {
    const cfg = channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    const bizContent = JSON.stringify({ out_trade_no: channelOrderNo })
    const commonParams = this.buildCommonParams(appId, 'alipay.trade.query')
    const allParams = { ...commonParams, biz_content: bizContent }
    const sign = this.signRsa2(allParams, privateKey)

    try {
      const response = await fetch(this.ALIPAY_GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Object.entries({ ...allParams, sign })
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&'),
      })

      const result = await response.json() as Record<string, unknown>
      const responseKey = 'alipay_trade_query_response'
      const responseData = result[responseKey] as Record<string, unknown> | undefined

      if (responseData?.code !== '10000') {
        return {
          channelOrderNo,
          status: 'FAILED',
          totalAmount: 0,
          message: (responseData?.sub_msg as string) || (responseData?.msg as string) || '查询失败',
        }
      }

      const tradeStatus = responseData.trade_status as string
      const totalAmountStr = responseData.total_amount as string
      const totalAmount = Math.round(parseFloat(totalAmountStr || '0') * 100)
      const gmtPayment = responseData.send_pay_date as string

      let status: OrderQueryResult['status']
      switch (tradeStatus) {
        case 'TRADE_SUCCESS':
        case 'TRADE_FINISHED':
          status = 'SUCCESS'
          break
        case 'TRADE_CLOSED':
          status = 'CLOSED'
          break
        case 'WAIT_BUYER_PAY':
          status = 'PENDING'
          break
        default:
          status = 'FAILED'
      }

      return {
        channelOrderNo,
        status,
        totalAmount,
        paidAt: gmtPayment ? new Date(gmtPayment) : undefined,
        message: tradeStatus,
      }
    } catch (error) {
      this.logger.error(`支付宝订单查询异常: ${error}`)
      return {
        channelOrderNo,
        status: 'PENDING',
        totalAmount: 0,
        message: '查询失败，请稍后重试',
      }
    }
  }

  parseRechargeCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): RechargeCallbackResult {
    const cfg = channelConfig
    const alipayPublicKey = cfg.alipayPublicKey as string

    if (!alipayPublicKey) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝公钥未配置，无法验证回调签名'))
    }

    const params: Record<string, string> = {}
    const searchParams = new URLSearchParams(rawBody)
    searchParams.forEach((value, key) => {
      params[key] = value
    })

    if (!this.verifyNotify(params, alipayPublicKey)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝回调签名验证失败'))
    }

    const tradeStatus = params.trade_status
    const status = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED' ? 'SUCCESS' : 'FAILED'

    const totalAmount = parseFloat(params.total_amount || '0')
    const amountFen = Math.round(totalAmount * 100)

    return {
      channelOrderNo: params.trade_no || params.out_trade_no,
      orderNo: params.out_trade_no,
      amount: amountFen,
      status,
      signature: params.sign || '',
    }
  }

  buildRechargeCallbackSuccess(): string {
    return 'success'
  }

  /**
   * 发起退款
   *
   * 支付宝退款接口：alipay.trade.refund
   */
  async refund(params: RefundRequest): Promise<RefundResponse> {
    const cfg = params.channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '支付宝配置不完整'))
    }

    const bizContent = JSON.stringify({
      out_trade_no: params.orderNo,
      refund_amount: (params.amount / 100).toFixed(2),
      refund_reason: params.reason || '用户退款',
      out_request_no: params.refundNo,
    })

    const commonParams = this.buildCommonParams(appId, 'alipay.trade.refund')
    const allParams = { ...commonParams, biz_content: bizContent }
    const sign = this.signRsa2(allParams, privateKey)

    try {
      const response = await fetch(this.ALIPAY_GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Object.entries({ ...allParams, sign })
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&'),
      })

      const result = await response.json() as Record<string, unknown>
      const responseKey = 'alipay_trade_refund_response'
      const responseData = result[responseKey] as Record<string, unknown> | undefined

      if (responseData?.code !== '10000') {
        this.logger.error(`支付宝退款失败: ${JSON.stringify(result)}`)
        throw new Error(`支付宝退款失败: ${responseData?.sub_msg || responseData?.msg || '未知错误'}`)
      }

      return {
        // channelRefundNo 编码 trade_no 与 out_request_no，供 queryRefund 调用
        // alipay.trade.fastpay.refund.query 接口（要求 out_request_no + trade_no/out_trade_no）
        channelRefundNo: `${responseData.trade_no}:${params.refundNo}`,
        status: 'PENDING',
        message: '退款受理中',
      }
    } catch (error) {
      this.logger.error(`支付宝退款调用异常: ${error}`)
      throw error
    }
  }

  /**
   * 查询退款状态
   *
   * 调用 alipay.trade.fastpay.refund.query 接口，按 out_request_no 精确查询单笔退款状态。
   * channelRefundNo 格式为 `${trade_no}:${out_request_no}`，由 refund() 方法生成。
   */
  async queryRefund(
    channelRefundNo: string,
    channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult> {
    const cfg = channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    // 解析 refund() 编码的 trade_no 与 out_request_no
    const sepIdx = channelRefundNo.lastIndexOf(':')
    if (sepIdx <= 0 || sepIdx === channelRefundNo.length - 1) {
      return {
        channelRefundNo,
        status: 'FAILED',
        message: 'channelRefundNo 格式非法，无法查询',
      }
    }
    const tradeNo = channelRefundNo.slice(0, sepIdx)
    const outRequestNo = channelRefundNo.slice(sepIdx + 1)

    // 支付宝退款查询接口：要求 out_request_no + (out_trade_no 或 trade_no)
    const bizContent = JSON.stringify({
      trade_no: tradeNo,
      out_request_no: outRequestNo,
    })
    const commonParams = this.buildCommonParams(appId, 'alipay.trade.fastpay.refund.query')
    const allParams = { ...commonParams, biz_content: bizContent }
    const sign = this.signRsa2(allParams, privateKey)

    try {
      const response = await fetch(this.ALIPAY_GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Object.entries({ ...allParams, sign })
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&'),
      })

      const result = await response.json() as Record<string, unknown>
      const responseKey = 'alipay_trade_fastpay_refund_query_response'
      const responseData = result[responseKey] as Record<string, unknown> | undefined

      if (responseData?.code !== '10000') {
        return {
          channelRefundNo,
          status: 'FAILED',
          message: (responseData?.sub_msg as string) || '查询失败',
        }
      }

      // refund_status = 'REFUND_SUCCESS' 表示该笔退款成功
      if (responseData.refund_status === 'REFUND_SUCCESS') {
        return {
          channelRefundNo,
          status: 'SUCCESS',
          message: '退款成功',
        }
      }

      return {
        channelRefundNo,
        status: 'PENDING',
        message: '退款处理中',
      }
    } catch {
      return {
        channelRefundNo,
        status: 'PENDING',
        message: '查询失败，请稍后重试',
      }
    }
  }

  /**
   * 解析退款回调
   */
  parseRefundCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): RefundCallbackResult {
    const cfg = channelConfig
    const alipayPublicKey = cfg.alipayPublicKey as string

    if (!alipayPublicKey) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝公钥未配置'))
    }

    const params: Record<string, string> = {}
    const searchParams = new URLSearchParams(rawBody)
    searchParams.forEach((value, key) => {
      params[key] = value
    })

    if (!this.verifyNotify(params, alipayPublicKey)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝退款回调签名验证失败'))
    }

    const totalAmount = parseFloat(params.total_amount || '0')
    const amountFen = Math.round(totalAmount * 100)

    return {
      channelRefundNo: params.trade_no || '',
      orderNo: params.out_trade_no || '',
      refundNo: params.out_request_no || '',
      amount: amountFen,
      status: 'SUCCESS',
      signature: params.sign || '',
    }
  }

  buildRefundCallbackSuccess(): string {
    return 'success'
  }

  async createPayout(params: PayoutRequest): Promise<PayoutResponse> {
    const cfg = params.channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    const bizContent = JSON.stringify({
      out_biz_no: params.orderNo,
      payee_type: 'ALIPAY_LOGON_ID',
      payee_account: params.channelAccount,
      amount: (params.amount / 100).toFixed(2),
      remark: `提现_${params.userName}`,
    })

    const commonParams = this.buildCommonParams(appId, 'alipay.fund.trans.uni.transfer')
    const allParams = { ...commonParams, biz_content: bizContent }
    const sign = this.signRsa2(allParams, privateKey)

    try {
      const response = await fetch(this.ALIPAY_GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Object.entries({ ...allParams, sign })
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&'),
      })

      const result = await response.json() as Record<string, unknown>
      const responseKey = 'alipay_fund_trans_uni_transfer_response'
      const responseData = result[responseKey] as Record<string, unknown> | undefined

      if (responseData?.code !== '10000') {
        this.logger.error(`支付宝转账失败: ${JSON.stringify(result)}`)
        throw new Error(`支付宝转账失败: ${responseData?.sub_msg || responseData?.msg || '未知错误'}`)
      }

      return {
        channelOrderNo: (responseData.order_id as string) || params.orderNo,
        status: 'PROCESSING',
        message: '转账受理中',
      }
    } catch (error) {
      this.logger.error(`支付宝转账调用异常: ${error}`)
      throw error
    }
  }

  async queryPayout(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<PayoutQueryResult> {
    const cfg = channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    const bizContent = JSON.stringify({ out_biz_no: channelOrderNo })
    const commonParams = this.buildCommonParams(appId, 'alipay.fund.trans.order.query')
    const allParams = { ...commonParams, biz_content: bizContent }
    const sign = this.signRsa2(allParams, privateKey)

    try {
      const response = await fetch(this.ALIPAY_GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Object.entries({ ...allParams, sign })
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&'),
      })

      const result = await response.json() as Record<string, unknown>
      const responseKey = 'alipay_fund_trans_order_query_response'
      const responseData = result[responseKey] as Record<string, unknown> | undefined

      if (responseData?.status === 'SUCCESS') {
        return { channelOrderNo, status: 'SUCCESS', message: '转账成功' }
      } else if (responseData?.status === 'FAIL') {
        return { channelOrderNo, status: 'FAILED', message: '转账失败' }
      }
      return { channelOrderNo, status: 'PROCESSING', message: '转账处理中' }
    } catch {
      return { channelOrderNo, status: 'PROCESSING', message: '查询失败，请稍后重试' }
    }
  }

  parsePayoutCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): {
    channelOrderNo: string
    orderNo: string
    status: 'SUCCESS' | 'FAILED'
    signature: string
  } {
    const alipayPublicKey = channelConfig.alipayPublicKey as string
    if (!alipayPublicKey) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝公钥未配置'))
    }

    const params: Record<string, string> = {}
    const searchParams = new URLSearchParams(rawBody)
    searchParams.forEach((value, key) => {
      params[key] = value
    })

    // 必须验签：否则攻击者可伪造 payout 成功回调，触发提现订单误标 SUCCESS
    // 导致资金已扣但实际未到账的严重资金事故
    if (!this.verifyNotify(params, alipayPublicKey)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝代付回调签名验证失败'))
    }

    return {
      channelOrderNo: params.out_biz_no || '',
      orderNo: params.out_biz_no || '',
      status: params.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      signature: params.sign || '',
    }
  }

  buildPayoutCallbackSuccess(): string {
    return 'success'
  }
}
