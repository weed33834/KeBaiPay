import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import { Request, Response } from 'express'
import { MetricsService } from './metrics.service'

/**
 * 全局指标拦截器
 *
 * 对每个 HTTP 请求记录：
 * 1. 进入时 in_flight +1
 * 2. 完成时 in_flight -1，并记录 status + 耗时
 *
 * route 用 req.route.path 或 originalUrl 兜底（404 路径无 route 匹配）。
 * 高基数 label（如带 ID 的 URL）会撑爆 Prometheus，这里统一用 originalUrl 的
 * 第一段路径作为 route，避免 /users/123 /users/456 各成一个时序。
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const req = context.switchToHttp().getRequest<Request>()
    const res = context.switchToHttp().getResponse<Response>()
    const method = req.method
    const route = this.normalizeRoute(req)

    this.metricsService.startHttpRequest(method, route)
    const start = process.hrtime.bigint()

    return next.handle().pipe(
      tap({
        next: () => {
          const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9
          this.metricsService.observeHttpRequest(method, route, res.statusCode, durationSeconds)
          this.metricsService.endHttpRequest(method, route)
        },
        // 拦截器抛错或异常过滤器处理后，res.statusCode 已被设置；这里仍要扣减 in_flight
        error: () => {
          const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9
          this.metricsService.observeHttpRequest(method, route, res.statusCode || 500, durationSeconds)
          this.metricsService.endHttpRequest(method, route)
        },
      }),
    )
  }

  /**
   * 路由归一化：取匹配的 route pattern，避免高基数 ID 撑爆 Prometheus
   * 例如 /users/123/profile → /users/:id/profile
   * 无 route 匹配时降级为 originalUrl 的第一段，避免 404 路径全部聚合为一条
   */
  private normalizeRoute(req: Request): string {
    const route = (req as any).route?.path
    if (route) return route

    // 404 或未匹配路由的请求：取第一段路径作为 route
    const originalUrl = req.originalUrl || req.url || '/'
    const segments = originalUrl.split('?')[0].split('/').filter(Boolean)
    if (segments.length === 0) return '/'
    return `/${segments[0]}`
  }
}
