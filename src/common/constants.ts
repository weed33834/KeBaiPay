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
