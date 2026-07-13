import { Injectable } from '@nestjs/common'
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client'

/**
 * Prometheus 指标服务
 *
 * 暴露三类指标：
 * 1. Node.js 运行时默认指标（GC、事件循环、内存等）
 * 2. HTTP 请求计数器（按 method/route/status 维度）
 * 3. HTTP 请求延迟直方图（按 method/route 维度）
 * 4. 进程启动时间（用于监控重启频次）
 *
 * /metrics 端点输出 Prometheus 文本格式，供 Prometheus server 抓取。
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry

  readonly httpRequestsTotal: Counter<string>
  readonly httpRequestDurationSeconds: Histogram<string>
  readonly httpRequestInFlight: Gauge<string>

  constructor() {
    // 使用独立 Registry，避免与其他库的全局注册冲突
    this.registry = new Registry()

    // 采集 Node.js 默认指标：event_loop_lag、gc_duration、heap_size、process_cpu、
    // process_start_time_seconds 等（已包含启动时间，无需重复注册）
    collectDefaultMetrics({ register: this.registry })

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'HTTP 请求总数',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    })

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP 请求处理耗时（秒）',
      labelNames: ['method', 'route'] as const,
      // buckets 覆盖 1ms ~ 10s 的典型 Web 请求区间
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    })

    this.httpRequestInFlight = new Gauge({
      name: 'http_request_in_flight',
      help: '当前处理中的 HTTP 请求数',
      labelNames: ['method', 'route'] as const,
      registers: [this.registry],
    })
  }

  /**
   * 输出 Prometheus 文本格式指标，供 /metrics 端点返回
   * prom-client 15.x 起 metrics() 返回 Promise，控制器需 await
   */
  async metrics(): Promise<string> {
    return this.registry.metrics()
  }

  contentType(): string {
    return this.registry.contentType
  }

  /**
   * 记录一次 HTTP 请求完成
   */
  observeHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpRequestsTotal.labels(method, route, String(status)).inc()
    this.httpRequestDurationSeconds.labels(method, route).observe(durationSeconds)
  }

  startHttpRequest(method: string, route: string): void {
    this.httpRequestInFlight.labels(method, route).inc()
  }

  endHttpRequest(method: string, route: string): void {
    this.httpRequestInFlight.labels(method, route).dec()
  }
}
