export const BCRYPT_SALT_ROUNDS = 10

/** 费率分母：万分之一 */
export const RATE_DENOMINATOR = 10000

/** 一天对应的毫秒数 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** 订单默认过期时间：30 分钟 */
export const ORDER_EXPIRY_MS = 30 * 60 * 1000
/** 订单最大允许过期时间：24 小时 */
export const MAX_ORDER_EXPIRY_MS = DAY_MS

/** 支付密码错误锁定时间：15 分钟 */
export const PAY_PASSWORD_LOCK_MS = 15 * 60 * 1000
/** 支付密码最大尝试次数 */
export const MAX_PAY_PASSWORD_ATTEMPTS = 5

/** 认证接口限流：每 60 秒最多 5 次 */
export const AUTH_THROTTLE_LIMIT = 5
export const AUTH_THROTTLE_TTL_MS = 60 * 1000

/** 开放 API 限流：每 60 秒最多 30 次 */
export const OPEN_API_THROTTLE_LIMIT = 30
export const OPEN_API_THROTTLE_TTL_MS = 60 * 1000

/** 全局限流：每 60 秒最多 100 次 */
export const GLOBAL_THROTTLE_LIMIT = 100
export const GLOBAL_THROTTLE_TTL_MS = 60 * 1000

/** 默认分页 */
export const DEFAULT_PAGE_SIZE = 10
export const MAX_PAGE_SIZE = 100
export const BILL_LIST_LIMIT = 50
export const MAX_EXPORT_ROWS = 10000

/** Redis 分布式锁默认 TTL：30 秒 */
export const REDIS_LOCK_TTL_SECONDS = 30

/** 默认日限额（单位：分） */
export const DEFAULT_TRANSFER_DAILY_LIMIT_CENTS = 50000 * 100 // 5 万元
export const DEFAULT_PAYMENT_DAILY_LIMIT_CENTS = 5000000 // 5 万元
export const DEFAULT_MERCHANT_DAILY_LIMIT_CENTS = 10000000 // 10 万元
export const DEFAULT_WITHDRAW_DAILY_LIMIT_CENTS = 20000 * 100 // 2 万元
export const DEFAULT_RED_PACKET_DAILY_LIMIT_CENTS = 5000 * 100 // 5 千元

/** 大额交易告警阈值（单位：分） */
export const LARGE_TRANSFER_THRESHOLD_CENTS = 50000 // 500 元
export const LARGE_WITHDRAWAL_THRESHOLD_CENTS = 20000 // 200 元

/** 红包有效期：24 小时 */
export const RED_PACKET_EXPIRY_MS = DAY_MS

/** 担保交易配置 */
/** 担保订单付款前有效期：30 分钟（与 ORDER_EXPIRY_MS 保持一致） */
export const ESCROW_PAY_DEADLINE_MS = ORDER_EXPIRY_MS
/** 发货后买家自动确认收货时间：7 天（超时系统自动放款给卖家） */
export const ESCROW_AUTO_CONFIRM_MS = 7 * DAY_MS
/** 担保交易日限额默认值（单位：分）：5 万元 */
export const DEFAULT_ESCROW_DAILY_LIMIT_CENTS = 50000 * 100
/** 大额担保交易告警阈值（单位：分）：500 元 */
export const LARGE_ESCROW_THRESHOLD_CENTS = 50000

/** 批量转账配置 */
/** 单批次最大明细数：500 笔 */
export const MAX_BATCH_TRANSFER_ITEMS = 500
/** 单笔批量转账明细金额上限：5000 元 */
export const MAX_BATCH_TRANSFER_ITEM_AMOUNT_CENTS = 500000
/** 批量转账日限额默认值（单位：分）：5 万元 */
export const DEFAULT_BATCH_TRANSFER_DAILY_LIMIT_CENTS = 50000 * 100
/** 大额批量转账告警阈值（单批次总金额）：5000 元 */
export const LARGE_BATCH_TRANSFER_THRESHOLD_CENTS = 500000

/** 订阅/周期扣款配置 */
/** 订阅每期金额上限：10000 元（分） */
export const MAX_SUBSCRIPTION_AMOUNT_CENTS = 10000 * 100
/** 订阅计划默认总期数（null 表示无限） */
export const DEFAULT_SUBSCRIPTION_TOTAL_CYCLES: number | null = null
/** 订阅扣款失败最大重试次数（连续失败后自动暂停） */
export const SUBSCRIPTION_MAX_FAILURES = 3
/** 单用户订阅计划数上限 */
export const MAX_SUBSCRIPTIONS_PER_USER = 100
/** 订阅单日扣款限额（单位：分）：1 万元 */
export const DEFAULT_SUBSCRIPTION_DAILY_LIMIT_CENTS = 10000 * 100
/** 大额订阅扣款告警阈值（单期金额）：1000 元 */
export const LARGE_SUBSCRIPTION_THRESHOLD_CENTS = 100000

// 分账 Split 配置
// 单次分账最多接收方数量
export const MAX_SPLIT_RECEIVERS = 50
// 单笔分账最小金额（分）：0.01 元
export const MIN_SPLIT_AMOUNT_CENTS = 1
// 单笔分账最大金额（分）：10000 元
export const MAX_SPLIT_AMOUNT_CENTS = 10000 * 100
// 单日分账限额（分）：50000 元
export const DEFAULT_SPLIT_DAILY_LIMIT_CENTS = 50000 * 100
// 大额分账告警阈值：5000 元
export const LARGE_SPLIT_THRESHOLD_CENTS = 500000

/** 邀请返现配置 */
// 默认邀请奖励金额（分）：10 元
export const DEFAULT_REFERRAL_REWARD_CENTS = 10 * 100
// 邀请奖励最大金额（分）：1000 元
export const MAX_REFERRAL_REWARD_CENTS = 1000 * 100
// 邀请码长度（去除易混字符 0/O/I/1）
export const REFERRAL_CODE_LENGTH = 8
// 触发奖励的交易最小金额（分）：1 元
export const REFERRAL_TRIGGER_MIN_AMOUNT_CENTS = 100
// 单用户最多邀请数量（0=不限）
export const MAX_REFERRALS_PER_USER = 0

/** 商户回调通知 */
export const MAX_CALLBACK_RETRIES = 5
export const CALLBACK_TIMEOUT_MS = 10 * 1000
// 已付款但通知失败的订单，距 paidAt 超过该时长的进入补偿重试队列
export const NOTIFY_RETRY_BACKOFF_MS = 5 * 60 * 1000
// 单次补偿任务最多处理的订单数，防止积压时一次性打爆下游
export const NOTIFY_RETRY_BATCH_SIZE = 100

/** 商户看板时间跨度 */
export const DASHBOARD_WEEK_DAYS = 7
export const DASHBOARD_MONTH_DAYS = 30

/**
 * JWT token 类型声明（typ 字段），用于区分 user/admin token。
 * 即使运维误将 JWT_USER_SECRET 与 JWT_ADMIN_SECRET 设为相同值，
 * 也可通过 typ 校验防止 admin token 被当 user token 使用（反之亦然）。
 */
export const JWT_TOKEN_TYPE_USER = 'user'
export const JWT_TOKEN_TYPE_ADMIN = 'admin'
export const JWT_TOKEN_TYPE_AGENT = 'agent'

/**
 * Agent 场景类型：标识 Agent 用途，决定可用工具集
 * - wallet：C 端钱包管家（查询账单、转账、发红包等）
 * - merchant：B 端店长助理（创建订单、对账、退款等）
 * - risk：A 端风控审计官（事件处置、规则生成、巡检告警）
 * - support：通用客服坐席
 */
export const AGENT_SCENARIOS = ['wallet', 'merchant', 'risk', 'support'] as const
export type AgentScenario = (typeof AGENT_SCENARIOS)[number]

/**
 * Agent 操作结果枚举
 */
export const AGENT_RESULT_SUCCESS = 'SUCCESS'
export const AGENT_RESULT_FAILED = 'FAILED'
export const AGENT_RESULT_PENDING_CONFIRM = 'PENDING_CONFIRM'
export const AGENT_RESULT_REJECTED = 'REJECTED'

/**
 * Agent 对话消息角色（OpenAI 风格）
 */
export const AGENT_ROLE_USER = 'USER'
export const AGENT_ROLE_ASSISTANT = 'ASSISTANT'
export const AGENT_ROLE_TOOL = 'TOOL'
export const AGENT_ROLE_SYSTEM = 'SYSTEM'

/**
 * Agent 链式 hash 起始 hash（同 AdminOperationLog 的 GENESIS_HASH）
 */
export const AGENT_GENESIS_HASH = '0'.repeat(64)

/**
 * Agent 咨询锁 ID（用于并发安全写入 AgentOperationLog）
 */
export const AGENT_LOG_ADVISORY_LOCK_ID = 8832
