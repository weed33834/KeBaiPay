/**
 * 链路追踪上下文（基于 AsyncLocalStorage）
 *
 * 在 RequestLoggingMiddleware 中通过 runWithTraceId 包装请求处理链，
 * service 层 Logger 调用时自动从 AsyncLocalStorage 取出 traceId 注入到日志前缀，
 * 无需 service 层手动拼接。
 *
 * 注意：AsyncLocalStorage 上下文会自动跨越 async/await 调用链，
 * 但不会传播到 setTimeout/setInterval 等显式创建的异步任务（除非用 AsyncResource 绑定）。
 * 对于回调类异步（如 res.on('finish')），应在创建回调时闭包捕获 traceId，不依赖 ALS。
 */

import { AsyncLocalStorage } from 'async_hooks'
import { Logger } from '@nestjs/common'

interface TraceContext {
  traceId: string
}

const traceStorage = new AsyncLocalStorage<TraceContext>()

/**
 * 在 traceId 上下文中执行 fn，fn 内的所有同步/await 调用都能通过 getTraceId() 取到 traceId
 */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn)
}

/**
 * 获取当前异步上下文中的 traceId；不在请求上下文中时返回 undefined
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId
}

/**
 * 在应用启动时调用一次：monkey-patch Logger 原型方法，
 * 使所有 service 层的 logger.log/warn/error/debug/verbose 自动注入 [traceId] 前缀。
 *
 * 幂等：多次调用只会 patch 一次。
 */
let patched = false
export function patchLoggerWithTraceId(): void {
  if (patched) return
  patched = true

  const proto = Logger.prototype as any
  const methods = ['log', 'warn', 'error', 'debug', 'verbose'] as const

  for (const method of methods) {
    const original = proto[method]
    if (typeof original !== 'function') continue
    proto[method] = function (message: unknown, ...args: unknown[]) {
      const traceId = getTraceId()
      if (traceId && typeof message === 'string') {
        message = `[${traceId}] ${message}`
      }
      return original.call(this, message, ...args)
    }
  }
}
