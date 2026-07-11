/**
 * 支付渠道抽象接口
 *
 * 每个真实渠道（支付宝、微信、银行代付等）实现此接口。
 * MockChannel 用于开发和测试环境。
 */

/**
 * 渠道配置对象
 *
 * 真实渠道的配置字段差异较大，统一用结构化 but 宽松的类型表示。
 * 各渠道实现时通过类型断言读取自己需要的字段。
 */
export interface ChannelConfig {
  [key: string]: string | number | boolean | undefined
}

/** 充值请求参数 */
export interface RechargeRequest {
  orderNo: string
  amount: number // 分
  userId: string
  subject: string
  notifyUrl: string
  channelConfig: ChannelConfig
  /** 支付方式：native-PC扫码/jsapi-微信内/h5-手机浏览器/page-电脑网站/wap-手机网站 */
  payMethod?: string
  /** JSAPI 支付时的 openid */
  openid?: string
}

/** 充值响应 */
export interface RechargeResponse {
  channelOrderNo: string
  payUrl?: string
  payParams?: ChannelConfig
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
}

/** 充值回调解析结果 */
export interface RechargeCallbackResult {
  channelOrderNo: string
  orderNo: string
  amount: number
  status: 'SUCCESS' | 'FAILED'
  signature: string
}

/** 代付请求参数 */
export interface PayoutRequest {
  orderNo: string
  amount: number // 实际到账金额，分
  channelAccount: string
  userName: string
  channelConfig: ChannelConfig
}

/** 代付响应 */
export interface PayoutResponse {
  channelOrderNo: string
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED'
  message?: string
}

/** 代付查询结果 */
export interface PayoutQueryResult {
  channelOrderNo: string
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED'
  message?: string
}

/** 退款请求参数 */
export interface RefundRequest {
  orderNo: string
  refundNo: string
  amount: number // 退款金额，分
  reason?: string
  channelConfig: ChannelConfig
  /** 原支付渠道订单号 */
  channelOrderNo: string
}

/** 退款响应 */
export interface RefundResponse {
  channelRefundNo: string
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  message?: string
}

/** 退款查询结果 */
export interface RefundQueryResult {
  channelRefundNo: string
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  message?: string
}

/** 退款回调解析结果 */
export interface RefundCallbackResult {
  channelRefundNo: string
  orderNo: string
  refundNo: string
  amount: number
  status: 'SUCCESS' | 'FAILED'
  signature: string
}

/** 支付订单查询结果 */
export interface OrderQueryResult {
  channelOrderNo: string
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CLOSED'
  totalAmount: number
  paidAt?: Date
  message?: string
}

/** 支付渠道接口 */
export interface PaymentChannel {
  /** 渠道编码 */
  readonly code: string

  /** 渠道名称 */
  readonly name: string

  /** 发起充值 */
  createRecharge(params: RechargeRequest): Promise<RechargeResponse>

  /** 解析充值回调（含验签） */
  parseRechargeCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): RechargeCallbackResult

  /** 生成充值回调成功响应 */
  buildRechargeCallbackSuccess(): string

  /** 发起代付 */
  createPayout(params: PayoutRequest): Promise<PayoutResponse>

  /** 查询代付状态 */
  queryPayout(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<PayoutQueryResult>

  /** 解析代付回调（含验签） */
  parsePayoutCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): {
    channelOrderNo: string
    orderNo: string
    status: 'SUCCESS' | 'FAILED'
    signature: string
  }

  /** 生成代付回调成功响应 */
  buildPayoutCallbackSuccess(): string

  /** 发起退款 */
  refund(params: RefundRequest): Promise<RefundResponse>

  /** 查询退款状态 */
  queryRefund(
    channelRefundNo: string,
    channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult>

  /** 解析退款回调（含验签） */
  parseRefundCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): RefundCallbackResult

  /** 生成退款回调成功响应 */
  buildRefundCallbackSuccess(): string

  /** 查询支付订单状态 */
  queryOrder(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<OrderQueryResult>
}
