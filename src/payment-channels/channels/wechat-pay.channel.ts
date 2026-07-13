import { Injectable, Logger } from '@nestjs/common'
import { createHash, createSign, createVerify, randomBytes } from 'crypto'
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
 * 微信支付 V3 渠道适配器
 *
 * 支持支付方式：
 *   native  - 电脑网站扫码支付
 *   jsapi   - 微信内H5支付（公众号/小程序）
 *   h5      - 手机浏览器支付
 *
 * 配置字段 (存储在 PaymentChannelConfig.config JSON 中):
 *   appid       - 商户绑定的应用ID
 *   mchid       - 商户号
 *   serialNo    - 商户API证书序列号
 *   privateKey  - 商户API私钥 (PEM字符串)
 *   apiV3Key    - APIv3密钥
 *   notifyUrl   - 回调通知地址
 *   platformCert - 平台证书公钥（用于验签回调）
 */
@Injectable()
export class WechatPayChannel implements PaymentChannel {
  readonly code = 'wechat'
  readonly name = '微信支付'
  private readonly logger = new Logger(WechatPayChannel.name)

  private readonly WX_PAY_BASE = 'https://api.mch.weixin.qq.com'

  /**
   * 生成 V3 签名
   */
  private signV3(
    method: string,
    urlPath: string,
    timestamp: string,
    nonceStr: string,
    body: string,
    privateKey: string,
  ): string {
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`
    const sign = createSign('RSA-SHA256')
    sign.update(message)
    return sign.sign(privateKey, 'base64')
  }

  /**
   * 验证 V3 回调签名
   */
  private verifyV3(
    timestamp: string,
    nonce: string,
    body: string,
    signature: string,
    serial: string,
    platformCert: string,
  ): boolean {
    const message = `${timestamp}\n${nonce}\n${body}\n`
    const verify = createVerify('RSA-SHA256')
    verify.update(message)
    return verify.verify(platformCert, signature, 'base64')
  }

  /**
   * AES-256-GCM 解密回调通知
   */
  private decryptGcm(
    ciphertext: string,
    nonce: string,
    associatedData: string,
    key: string,
  ): string {
    const { createDecipheriv } = require('crypto')
    const enc = Buffer.from(ciphertext, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf-8'), Buffer.from(nonce, 'utf-8'))
    decipher.setAAD(Buffer.from(associatedData, 'utf-8'))
    const authTag = enc.slice(enc.length - 16)
    decipher.setAuthTag(authTag)
    const encrypted = enc.slice(0, enc.length - 16)
    const dec = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return dec.toString('utf-8')
  }

  /**
   * 获取平台证书（从配置或缓存）
   */
  private getPlatformCert(channelConfig: ChannelConfig): string | null {
    return (channelConfig.platformCert as string) || null
  }

  /**
   * 验证回调签名（公开方法供 webhook 使用）
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): boolean {
    const timestamp = headers['wechatpay-timestamp'] || ''
    const nonce = headers['wechatpay-nonce'] || ''
    const signature = headers['wechatpay-signature'] || ''
    const serial = headers['wechatpay-serial'] || ''
    const platformCert = this.getPlatformCert(channelConfig)

    if (!platformCert) {
      this.logger.error('平台证书未配置，拒绝回调签名验证')
      return false
    }

    return this.verifyV3(timestamp, nonce, rawBody, signature, serial, platformCert)
  }

  /**
   * 构建通用下单请求体
   */
  private buildOrderBody(
    params: RechargeRequest,
    channelConfig: ChannelConfig,
    payMethod: string,
  ): { body: string; urlPath: string } {
    const cfg = channelConfig
    const appid = cfg.appid as string
    const mchid = cfg.mchid as string
    const notifyUrl = (cfg.notifyUrl as string) || params.notifyUrl

    if (!appid || !mchid) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '微信支付配置不完整：缺少 appid/mchid'))
    }

    const orderBody: Record<string, unknown> = {
      appid,
      mchid,
      description: params.subject,
      out_trade_no: params.orderNo,
      notify_url: notifyUrl,
      amount: {
        total: params.amount,
        currency: 'CNY',
      },
    }

    let urlPath: string

    switch (payMethod) {
      case 'jsapi': {
        if (!params.openid) {
          throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, 'JSAPI 支付需要提供 openid'))
        }
        orderBody.payer = { openid: params.openid }
        urlPath = '/v3/pay/transactions/jsapi'
        break
      }
      case 'h5': {
        orderBody.scene_info = {
          payer_client_ip: '127.0.0.1',
          h5_info: {
            type: 'Wap',
            wap_url: channelConfig.wapUrl as string || 'https://www.example.com',
            wap_name: channelConfig.wapName as string || 'KeBaiPay',
          },
        }
        urlPath = '/v3/pay/transactions/h5'
        break
      }
      case 'native':
      default: {
        urlPath = '/v3/pay/transactions/native'
        break
      }
    }

    return { body: JSON.stringify(orderBody), urlPath }
  }

  async createRecharge(params: RechargeRequest): Promise<RechargeResponse> {
    const cfg = params.channelConfig
    const serialNo = cfg.serialNo as string
    const privateKey = cfg.privateKey as string
    const mchid = cfg.mchid as string

    if (!privateKey) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '微信支付配置不完整：缺少 privateKey'))
    }

    const payMethod = params.payMethod || 'native'
    const { body, urlPath } = this.buildOrderBody(params, cfg, payMethod)

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')

    const signature = this.signV3('POST', urlPath, timestamp, nonceStr, body, privateKey)
    const authHeader = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

    try {
      const response = await fetch(`${this.WX_PAY_BASE}${urlPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        body,
      })

      const result = await response.json() as Record<string, unknown>

      if (result.code && result.code !== 'SUCCESS') {
        this.logger.error(`微信支付下单失败: ${JSON.stringify(result)}`)
        throw new Error(`微信支付下单失败: ${result.message || result.code}`)
      }

      let payUrl: string | undefined
      const payParams: ChannelConfig = {}

      switch (payMethod) {
        case 'jsapi':
          payParams.prepay_id = (result.prepay_id as string) || ''
          payParams.appid = cfg.appid as string
          payParams.timestamp = Math.floor(Date.now() / 1000).toString()
          payParams.nonce_str = randomBytes(16).toString('hex')
          payParams.package = `prepay_id=${payParams.prepay_id}`
          payParams.signType = 'RSA2'
          // 生成小程序/公众号调起支付的签名
          const paySignStr = `${payParams.appid}\n${payParams.timestamp}\n${payParams.nonce_str}\n${payParams.package}\n`
          const paySign = createSign('RSA-SHA256')
          paySign.update(paySignStr)
          payParams.paySign = paySign.sign(privateKey, 'base64')
          break
        case 'h5':
          payUrl = (result.h5_url as string) || undefined
          payParams.h5_url = payUrl
          break
        case 'native':
        default:
          payUrl = (result.code_url as string) || undefined
          payParams.code_url = payUrl
          break
      }

      return {
        channelOrderNo: params.orderNo,
        payUrl,
        payParams,
        status: 'PENDING',
      }
    } catch (error) {
      this.logger.error(`微信支付调用异常: ${error}`)
      throw error
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
    const mchid = cfg.mchid as string
    const serialNo = cfg.serialNo as string
    const privateKey = cfg.privateKey as string

    if (!mchid || !privateKey) {
      throw new Error('微信支付配置不完整')
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')
    const urlPath = `/v3/pay/transactions/out-trade-no/${channelOrderNo}?mchid=${mchid}`
    const signature = this.signV3('GET', urlPath, timestamp, nonceStr, '', privateKey)

    const authHeader = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

    try {
      const response = await fetch(`${this.WX_PAY_BASE}${urlPath}`, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      })

      const result = await response.json() as Record<string, unknown>

      if (result.code && result.code !== 'SUCCESS') {
        return {
          channelOrderNo,
          status: 'FAILED',
          totalAmount: 0,
          message: (result.message as string) || '查询失败',
        }
      }

      const tradeState = result.trade_state as string
      const totalAmount = (result.amount as Record<string, unknown>)?.total as number || 0
      const successTime = result.success_time as string

      let status: OrderQueryResult['status']
      switch (tradeState) {
        case 'SUCCESS':
          status = 'SUCCESS'
          break
        case 'CLOSED':
        case 'REVOKED':
          status = 'CLOSED'
          break
        case 'NOTPAY':
        case 'USERPAYING':
          status = 'PENDING'
          break
        default:
          status = 'FAILED'
      }

      return {
        channelOrderNo,
        status,
        totalAmount,
        paidAt: successTime ? new Date(successTime) : undefined,
        message: tradeState,
      }
    } catch (error) {
      this.logger.error(`微信支付查询异常: ${error}`)
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
    const apiV3Key = cfg.apiV3Key as string

    if (!apiV3Key) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付 APIv3 密钥未配置'))
    }

    let body: { resource: { ciphertext: string; nonce: string; associated_data: string }; out_trade_no: string }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付回调 body 非 JSON'))
    }

    let decrypted: string
    try {
      decrypted = this.decryptGcm(
        body.resource.ciphertext,
        body.resource.nonce,
        body.resource.associated_data,
        apiV3Key,
      )
    } catch (error) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付回调解密失败'))
    }

    let resource: { out_trade_no: string; transaction_id: string; trade_state: string; amount: { total: number } }
    try {
      resource = JSON.parse(decrypted)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付回调解密数据格式错误'))
    }

    const status = resource.trade_state === 'SUCCESS' ? 'SUCCESS' : 'FAILED'

    return {
      channelOrderNo: resource.transaction_id || body.out_trade_no,
      orderNo: resource.out_trade_no,
      amount: resource.amount?.total || 0,
      status,
      signature: headers['wechatpay-signature'] || '',
    }
  }

  buildRechargeCallbackSuccess(): string {
    return JSON.stringify({ code: 'SUCCESS', message: '成功' })
  }

  /**
   * 发起退款
   *
   * 微信支付 V3 退款接口：POST /v3/refund/domestic/refunds
   */
  async refund(params: RefundRequest): Promise<RefundResponse> {
    const cfg = params.channelConfig
    const mchid = cfg.mchid as string
    const serialNo = cfg.serialNo as string
    const privateKey = cfg.privateKey as string
    const notifyUrl = (cfg.refundNotifyUrl as string) || (cfg.notifyUrl as string)

    if (!mchid || !privateKey) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '微信支付配置不完整'))
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')

    const body = JSON.stringify({
      out_trade_no: params.orderNo,
      out_refund_no: params.refundNo,
      reason: params.reason || '用户退款',
      notify_url: notifyUrl,
      amount: {
        refund: params.amount,
        total: params.amount,
        currency: 'CNY',
      },
    })

    const urlPath = '/v3/refund/domestic/refunds'
    const signature = this.signV3('POST', urlPath, timestamp, nonceStr, body, privateKey)

    const authHeader = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

    try {
      const response = await fetch(`${this.WX_PAY_BASE}${urlPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        body,
      })

      const result = await response.json() as Record<string, unknown>

      if (result.code && result.code !== 'SUCCESS') {
        this.logger.error(`微信退款失败: ${JSON.stringify(result)}`)
        throw new Error(`微信退款失败: ${result.message || result.code}`)
      }

      const status = result.status as string
      let refundStatus: RefundResponse['status']
      switch (status) {
        case 'SUCCESS':
          refundStatus = 'SUCCESS'
          break
        case 'PROCESSING':
          refundStatus = 'PENDING'
          break
        default:
          refundStatus = 'FAILED'
      }

      return {
        channelRefundNo: (result.refund_id as string) || params.refundNo,
        status: refundStatus,
        message: status,
      }
    } catch (error) {
      this.logger.error(`微信退款调用异常: ${error}`)
      throw error
    }
  }

  /**
   * 查询退款状态
   */
  async queryRefund(
    channelRefundNo: string,
    channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult> {
    const cfg = channelConfig
    const mchid = cfg.mchid as string
    const serialNo = cfg.serialNo as string
    const privateKey = cfg.privateKey as string

    if (!mchid || !privateKey) {
      throw new Error('微信支付配置不完整')
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')
    const urlPath = `/v3/refund/domestic/refunds/${channelRefundNo}`
    const signature = this.signV3('GET', urlPath, timestamp, nonceStr, '', privateKey)

    const authHeader = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

    try {
      const response = await fetch(`${this.WX_PAY_BASE}${urlPath}`, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      })

      const result = await response.json() as Record<string, unknown>

      if (result.code && result.code !== 'SUCCESS') {
        return {
          channelRefundNo,
          status: 'FAILED',
          message: (result.message as string) || '查询失败',
        }
      }

      const status = result.status as string
      let refundStatus: RefundQueryResult['status']
      switch (status) {
        case 'SUCCESS':
          refundStatus = 'SUCCESS'
          break
        case 'PROCESSING':
          refundStatus = 'PENDING'
          break
        default:
          refundStatus = 'FAILED'
      }

      return {
        channelRefundNo,
        status: refundStatus,
        message: status,
      }
    } catch (error) {
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
    const apiV3Key = cfg.apiV3Key as string

    if (!apiV3Key) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付 APIv3 密钥未配置'))
    }

    let body: {
      resource: { ciphertext: string; nonce: string; associated_data: string }
      out_trade_no: string
    }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信退款回调 body 非 JSON'))
    }

    let decrypted: string
    try {
      decrypted = this.decryptGcm(
        body.resource.ciphertext,
        body.resource.nonce,
        body.resource.associated_data,
        apiV3Key,
      )
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信退款回调解密失败'))
    }

    let resource: {
      out_trade_no: string
      out_refund_no: string
      refund_id: string
      refund_status: string
      amount: { refund: number }
    }
    try {
      resource = JSON.parse(decrypted)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信退款回调解密数据格式错误'))
    }

    const status = resource.refund_status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'

    return {
      channelRefundNo: resource.refund_id,
      orderNo: resource.out_trade_no,
      refundNo: resource.out_refund_no,
      amount: resource.amount?.refund || 0,
      status,
      signature: headers['wechatpay-signature'] || '',
    }
  }

  buildRefundCallbackSuccess(): string {
    return JSON.stringify({ code: 'SUCCESS', message: '成功' })
  }

  async createPayout(params: PayoutRequest): Promise<PayoutResponse> {
    const cfg = params.channelConfig
    const appid = cfg.appid as string
    const mchid = cfg.mchid as string
    const serialNo = cfg.serialNo as string
    const privateKey = cfg.privateKey as string

    if (!appid || !mchid || !privateKey) {
      throw new Error('微信支付配置不完整')
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')

    const body = JSON.stringify({
      appid,
      mchid,
      out_batch_no: params.orderNo,
      batch_name: `提现_${params.orderNo}`,
      batch_num: 1,
      batch_detail: [
        {
          out_detail_no: params.orderNo,
          transfer_amount: params.amount,
          openid: params.channelAccount,
          transfer_remark: params.userName,
        },
      ],
    })

    const urlPath = '/v3/transfer/batches'
    const signature = this.signV3('POST', urlPath, timestamp, nonceStr, body, privateKey)

    const authHeader = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

    try {
      const response = await fetch(`${this.WX_PAY_BASE}${urlPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        body,
      })

      const result = await response.json() as Record<string, unknown>

      if (result.code && result.code !== 'SUCCESS') {
        this.logger.error(`微信转账失败: ${JSON.stringify(result)}`)
        throw new Error(`微信转账失败: ${result.message || result.code}`)
      }

      return {
        channelOrderNo: (result.batch_id as string) || params.orderNo,
        status: 'PROCESSING',
        message: '转账受理中',
      }
    } catch (error) {
      this.logger.error(`微信转账调用异常: ${error}`)
      throw error
    }
  }

  async queryPayout(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<PayoutQueryResult> {
    const cfg = channelConfig
    const mchid = cfg.mchid as string
    const serialNo = cfg.serialNo as string
    const privateKey = cfg.privateKey as string

    if (!mchid || !privateKey) {
      throw new Error('微信支付配置不完整')
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonceStr = randomBytes(16).toString('hex')
    const urlPath = `/v3/transfer/batches/${channelOrderNo}`
    const signature = this.signV3('GET', urlPath, timestamp, nonceStr, '', privateKey)

    const authHeader = `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

    try {
      const response = await fetch(`${this.WX_PAY_BASE}${urlPath}`, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      })

      const result = await response.json() as Record<string, unknown>
      const batchStatus = result.batch_status as string

      if (batchStatus === 'FINISHED') {
        return { channelOrderNo, status: 'SUCCESS', message: '转账完成' }
      } else if (batchStatus === 'FAILED') {
        return { channelOrderNo, status: 'FAILED', message: '转账失败' }
      }
      return { channelOrderNo, status: 'PROCESSING', message: '转账处理中' }
    } catch (error) {
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
    const apiV3Key = channelConfig.apiV3Key as string
    if (!apiV3Key) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付 APIv3 密钥未配置'))
    }

    // 微信代付（商家转账到零钱）回调也是加密的，必须先解密 resource 才能拿到明文状态。
    // 直接 JSON.parse(rawBody) 会拿到 ciphertext，无法获取 batch_status 等业务字段，
    // 也不能直接信任 envelope 中的明文（攻击者可伪造未加密回调触发提现订单误标 SUCCESS）
    let body: {
      resource: { ciphertext: string; nonce: string; associated_data: string }
    }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信代付回调 body 非 JSON'))
    }

    let decrypted: string
    try {
      decrypted = this.decryptGcm(
        body.resource.ciphertext,
        body.resource.nonce,
        body.resource.associated_data,
        apiV3Key,
      )
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信代付回调解密失败'))
    }

    let resource: {
      batch_id: string
      out_batch_no: string
      batch_status: string
    }
    try {
      resource = JSON.parse(decrypted)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信代付回调解密数据格式错误'))
    }

    return {
      channelOrderNo: resource.batch_id || '',
      orderNo: resource.out_batch_no || '',
      status: resource.batch_status === 'FINISHED' ? 'SUCCESS' : 'FAILED',
      signature: headers['wechatpay-signature'] || '',
    }
  }

  buildPayoutCallbackSuccess(): string {
    return JSON.stringify({ code: 'SUCCESS', message: '成功' })
  }
}
