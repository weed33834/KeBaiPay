/**
 * API 响应格式约定
 *
 * 设计原则（RESTful + 可观测性）：
 * - 成功响应（HTTP 2xx）：body 直接返回业务数据，不包裹 envelope
 *   客户端用 HTTP 状态码判断成功/失败，成功时直接读 body 作为业务数据
 * - 错误响应（HTTP 4xx/5xx）：body 返回 ApiErrorResponse envelope
 *   客户端读 envelope 中的 code/message 定位具体错误，traceId 用于关联日志
 * - 所有响应（成功/错误）都带 X-Request-Id header，便于客户端/服务端日志关联
 *
 * 例：
 *   成功：HTTP 200, body = { orderNo: '...', status: 'PENDING', ... }
 *   错误：HTTP 400, body = { code: 'KB400', message: '参数错误', data: null, traceId: 'abc-123' }
 */

/**
 * 错误响应 envelope（仅异常路径使用）
 *
 * AllExceptionsFilter 统一构造此结构，
 * 正常响应不包裹 envelope，直接返回业务数据。
 */
export interface ApiErrorResponse {
  /** 业务错误码，格式 KBxxx */
  code: string
  /** 错误消息，含 KBxxx 前缀，可直接展示给用户或用于日志 */
  message: string
  /** 错误响应固定为 null，便于客户端统一解构 */
  data: null
  /** 链路追踪 ID，与响应头 X-Request-Id 一致，用于关联服务端日志 */
  traceId: string
}
