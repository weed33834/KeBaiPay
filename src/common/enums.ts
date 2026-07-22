// Prisma-compatible enum constants for SQLite (no native enum support)
// Use these string constants instead of Prisma enum types

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FINANCE = 'FINANCE',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
  RISK_OFFICER = 'RISK_OFFICER',
}

export enum AdminStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  EXPENSE_RESTRICTED = 'EXPENSE_RESTRICTED',
  INCOME_RESTRICTED = 'INCOME_RESTRICTED',
  FROZEN = 'FROZEN',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RealNameStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum MerchantType {
  PERSONAL = 'PERSONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum MerchantStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
}

export enum LedgerType {
  RECHARGE = 'RECHARGE',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  RED_PACKET = 'RED_PACKET',
  FEE = 'FEE',
  ADJUSTMENT = 'ADJUSTMENT',
  ESCROW = 'ESCROW',
  ESCROW_RELEASE = 'ESCROW_RELEASE',
  ESCROW_REFUND = 'ESCROW_REFUND',
  BATCH_TRANSFER = 'BATCH_TRANSFER',
  SUBSCRIPTION = 'SUBSCRIPTION',
  REFERRAL_REWARD = 'REFERRAL_REWARD',
}

export enum Direction {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum TransactionType {
  RECHARGE = 'RECHARGE',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  RED_PACKET = 'RED_PACKET',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum BillType {
  RECHARGE = 'RECHARGE',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  RECEIPT = 'RECEIPT',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  RED_PACKET = 'RED_PACKET',
  ESCROW = 'ESCROW',
  ESCROW_INCOME = 'ESCROW_INCOME',
  ESCROW_REFUND = 'ESCROW_REFUND',
  SUBSCRIPTION = 'SUBSCRIPTION',
  SUBSCRIPTION_INCOME = 'SUBSCRIPTION_INCOME',
  REFERRAL_REWARD = 'REFERRAL_REWARD',
  REFERRAL_INCOME = 'REFERRAL_INCOME',
}

export enum BillDirection {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

export enum RedPacketStatus {
  PENDING = 'PENDING',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  EXPIRED = 'EXPIRED',
}

/**
 * 微信原生红包类型
 * - LUCKY: 拼手气红包（金额随机分配）
 * - ORDINARY: 普通红包（每人固定金额）
 * - EXCLUSIVE: 专属红包（指定 receiverId 领取）
 * - PASSWORD: 口令红包（需输入密码领取）
 */
export enum RedPacketType {
  LUCKY = 'LUCKY',
  ORDINARY = 'ORDINARY',
  EXCLUSIVE = 'EXCLUSIVE',
  PASSWORD = 'PASSWORD',
}

export enum RedPacketRecordType {
  RECEIVE = 'RECEIVE',
  RETURN = 'RETURN',
}

export enum QrCodeType {
  PERSONAL = 'PERSONAL',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  MERCHANT = 'MERCHANT',
}

export enum QrCodeStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum AppStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum PaymentOrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CLOSED = 'CLOSED',
  REFUNDED = 'REFUNDED',
}

export enum NotifyStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum RiskEventType {
  LARGE_TRANSFER = 'LARGE_TRANSFER',
  LARGE_WITHDRAWAL = 'LARGE_WITHDRAWAL',
  LARGE_PAYMENT = 'LARGE_PAYMENT',
  SUSPICIOUS_RED_PACKET = 'SUSPICIOUS_RED_PACKET',
  FREQUENT_TRANSACTION = 'FREQUENT_TRANSACTION',
  FREQUENT_LOGIN = 'FREQUENT_LOGIN',
  SUSPICIOUS_DEVICE = 'SUSPICIOUS_DEVICE',
  ACCOUNT_FROZEN = 'ACCOUNT_FROZEN',
  STATUS_CHANGED = 'STATUS_CHANGED',
}

export enum ReconciliationStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SNAPSHOT_MISSING = 'SNAPSHOT_MISSING',
}

export enum ChannelType {
  RECHARGE = 'RECHARGE',
  PAYOUT = 'PAYOUT',
  BOTH = 'BOTH',
}

// 担保交易状态机：
// CREATED → PAID（资金冻结）→ SHIPPED → RECEIVED（放款给卖家）
//                    ↓                       ↓
//              CANCELLED/EXPIRED       REFUND_REQUESTED → REFUNDED
//                                                          ↓
//                                                       DISPUTE → RESOLVED
export enum EscrowStatus {
  CREATED = 'CREATED',                  // 买家创建订单，等待付款
  PAID = 'PAID',                        // 买家已付款（资金冻结）
  SHIPPED = 'SHIPPED',                  // 卖家已发货
  RECEIVED = 'RECEIVED',                // 买家已确认收货（资金已放款给卖家）
  REFUND_REQUESTED = 'REFUND_REQUESTED',// 买家申请退款，等待卖家同意
  REFUNDED = 'REFUNDED',                // 退款已完成（资金退给买家）
  DISPUTE = 'DISPUTE',                  // 争议中，等待管理员裁决
  CANCELLED = 'CANCELLED',              // 买家取消（仅 CREATED 状态可取消）
  EXPIRED = 'EXPIRED',                  // 超时未付款自动取消
}

// 批量转账状态
export enum BatchTransferStatus {
  PENDING = 'PENDING',                   // 已提交，待处理
  PROCESSING = 'PROCESSING',             // 处理中（部分成功）
  COMPLETED = 'COMPLETED',               // 全部完成（包含失败项）
  CANCELLED = 'CANCELLED',               // 已取消（未处理的项不再执行）
}

export enum BatchItemStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

// 订阅计划周期
export enum SubscriptionPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

// 订阅状态
export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',           // 活跃，按周期扣款
  SUSPENDED = 'SUSPENDED',    // 暂停（不扣款）
  CANCELLED = 'CANCELLED',    // 已取消
  EXPIRED = 'EXPIRED',         // 已到期（totalCycles 达到）
}

// 订阅扣款记录状态
export enum SubscriptionChargeStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

// 订阅计划状态
export enum SubscriptionPlanStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

// 分账订单状态
export enum SplitStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// 分账明细状态
export enum SplitItemStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

// 优惠券类型
export enum CouponType {
  FIXED = 'FIXED',         // 固定金额减免
  PERCENT = 'PERCENT',     // 百分比折扣
}

// 优惠券状态
export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

// 用户优惠券状态
export enum UserCouponStatus {
  AVAILABLE = 'AVAILABLE',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
}

// 消息分类
export enum MessageCategory {
  SYSTEM = 'SYSTEM',           // 系统通知
  TRANSACTION = 'TRANSACTION', // 交易通知
  PROMOTION = 'PROMOTION',     // 营销推广
  RISK = 'RISK',               // 风控通知
}

// 消息优先级
export enum MessagePriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

// 消息状态
export enum MessageStatus {
  SENT = 'SENT',       // 已发送
  READ = 'READ',       // 已读
  ARCHIVED = 'ARCHIVED', // 已归档
}

// 推送通道
export enum NotifyChannel {
  IN_APP = 'IN_APP',   // 站内信
  SMS = 'SMS',         // 短信
  EMAIL = 'EMAIL',     // 邮件
}

// 发票类型
export enum InvoiceType {
  NORMAL = 'NORMAL',       // 普通发票
  SPECIAL = 'SPECIAL',     // 专用发票
}

// 发票状态
export enum InvoiceStatus {
  PENDING = 'PENDING',     // 待开具
  ISSUED = 'ISSUED',       // 已开具
  CANCELLED = 'CANCELLED', // 已作废
}

// 风控审计会话状态
export enum RiskAuditSessionStatus {
  ACTIVE = 'ACTIVE',       // 进行中
  CLOSED = 'CLOSED',       // 已关闭
}

// 风控审计消息角色
export enum RiskAuditMessageRole {
  USER = 'USER',                 // 用户消息
  ASSISTANT = 'ASSISTANT',       // AI 助手回复
  SYSTEM = 'SYSTEM',             // 系统消息
}

// 风控审计意图分类（用于 AI 引擎分流）
export enum RiskAuditIntent {
  GREETING = 'GREETING',                       // 问候/帮助
  RULE_LIST = 'RULE_LIST',                     // 查询风控规则
  RULE_DETAIL = 'RULE_DETAIL',                 // 查询某条规则详情
  EVENT_LIST = 'EVENT_LIST',                   // 查询风险事件
  EVENT_EXPLAIN = 'EVENT_EXPLAIN',             // 解释为何被拦截
  TRANSACTION_LIST = 'TRANSACTION_LIST',       // 查询最近交易
  ACCOUNT_STATUS = 'ACCOUNT_STATUS',           // 账户状态查询
  APPEAL = 'APPEAL',                           // 申诉/解冻请求
  UNKNOWN = 'UNKNOWN',                         // 未识别意图
}

// 自定义规则 DSL：支持的字段
export enum CustomRuleField {
  AMOUNT = 'amount',                  // 交易金额（分）
  TYPE = 'type',                      // 交易类型
  HOUR = 'hour',                      // 当前小时 (0-23)
  DAY_OF_WEEK = 'dayOfWeek',          // 星期几 (0=周日, 6=周六)
  USER_RISK_LEVEL = 'userRiskLevel',  // 用户风险等级
  IP = 'ip',                          // 用户 IP
}

// 自定义规则 DSL：支持的算子
export enum CustomRuleOperator {
  EQ = '==',
  NE = '!=',
  GT = '>',
  GTE = '>=',
  LT = '<',
  LTE = '<=',
  IN = 'in',
  NOT_IN = 'not_in',
  IN_RANGE = 'in_range',       // 范围（支持跨午夜）
  CONTAINS = 'contains',       // 字符串包含
}

// 自定义规则逻辑运算符
export enum CustomRuleLogicalOp {
  AND = 'AND',
  OR = 'OR',
}

// 邀请关系状态
export enum ReferralStatus {
  PENDING = 'PENDING',     // 已绑定邀请关系，等待触发奖励
  COMPLETED = 'COMPLETED', // 已完成奖励发放
  CANCELLED = 'CANCELLED', // 已取消（如违规）
}

// 账本类型：增加返现类型
export enum ReferralLedgerType {
  REFERRAL_REWARD = 'REFERRAL_REWARD',
}

// S5 多平台对账聚合：渠道对账单状态
export enum ChannelStatementStatus {
  PENDING = 'PENDING',     // 待拉取
  FETCHED = 'FETCHED',     // 已拉取
  FAILED = 'FAILED',       // 拉取失败
}

// S5 渠道对账单条目类型（与渠道流水类型对应）
export enum ChannelStatementItemType {
  RECHARGE = 'RECHARGE',   // 充值/收款
  PAYOUT = 'PAYOUT',       // 代付/提现
  REFUND = 'REFUND',       // 退款
}

// S5 匹配状态
export enum MatchStatus {
  UNMATCHED = 'UNMATCHED',     // 未匹配
  MATCHED = 'MATCHED',         // 完全匹配
  MISMATCHED = 'MISMATCHED',   // 匹配但有差异（金额/状态不一致）
}

// S5 对账差异类型
export enum ReconciliationDiffType {
  MISSING_IN_CHANNEL = 'MISSING_IN_CHANNEL',     // 平台有，渠道无
  MISSING_IN_PLATFORM = 'MISSING_IN_PLATFORM',   // 渠道有，平台无
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',           // 金额不一致
  STATUS_MISMATCH = 'STATUS_MISMATCH',           // 状态不一致
}

// S5 对账差异处理状态
export enum ReconciliationDiffStatus {
  PENDING = 'PENDING',               // 待处理
  INVESTIGATING = 'INVESTIGATING',   // 调查中
  RESOLVED = 'RESOLVED',             // 已解决
  IGNORED = 'IGNORED',               // 已忽略
}
