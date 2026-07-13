import { MetricsService } from './metrics.service'

describe('MetricsService', () => {
  let service: MetricsService

  beforeEach(() => {
    service = new MetricsService()
  })

  describe('指标注册', () => {
    it('metrics() 返回 Prometheus 文本格式，包含默认运行时指标', async () => {
      const out = await service.metrics()
      // collectDefaultMetrics 会注入 process_cpu_、nodejs_gc_ 等
      expect(out).toMatch(/process_start_time_seconds/)
      expect(out).toMatch(/nodejs_version_info|process_cpu|nodejs_heap|event_loop/)
    })

    it('contentType 返回 Prometheus 标准 MIME', () => {
      expect(service.contentType()).toMatch(/text\/plain/)
    })
  })

  describe('HTTP 请求指标', () => {
    it('observeHttpRequest 计数器递增并记录耗时', async () => {
      service.observeHttpRequest('GET', '/users', 200, 0.05)
      service.observeHttpRequest('GET', '/users', 200, 0.1)
      service.observeHttpRequest('GET', '/users', 500, 1.2)

      const out = await service.metrics()
      // 三次请求应被记录：两次 200，一次 500
      const line200 = out.match(/http_requests_total\{method="GET",route="\/users",status="200"\} (\d+)/)
      const line500 = out.match(/http_requests_total\{method="GET",route="\/users",status="500"\} (\d+)/)
      expect(line200).not.toBeNull()
      expect(line500).not.toBeNull()
      expect(Number(line500![1])).toBe(1)
    })

    it('http_request_duration_seconds 直方图含 bucket 与 _sum/_count', async () => {
      service.observeHttpRequest('POST', '/auth', 201, 0.025)
      const out = await service.metrics()
      expect(out).toMatch(/http_request_duration_seconds_bucket\{.*le="0\.025"/)
      expect(out).toMatch(/http_request_duration_seconds_count\{method="POST",route="\/auth"\}/)
      expect(out).toMatch(/http_request_duration_seconds_sum\{method="POST",route="\/auth"\}/)
    })

    it('startHttpRequest / endHttpRequest 调整 in_flight gauge', async () => {
      service.startHttpRequest('GET', '/users')
      service.startHttpRequest('GET', '/users')
      let out = await service.metrics()
      const inFlight = out.match(/http_request_in_flight\{method="GET",route="\/users"\} (\d+)/)
      expect(inFlight).not.toBeNull()
      expect(Number(inFlight![1])).toBe(2)

      service.endHttpRequest('GET', '/users')
      out = await service.metrics()
      const after = out.match(/http_request_in_flight\{method="GET",route="\/users"\} (\d+)/)
      expect(Number(after![1])).toBe(1)
    })
  })

  describe('process_start_time_seconds', () => {
    it('启动时间被记录为合理的 Unix 时间戳（秒）', async () => {
      const out = await service.metrics()
      const m = out.match(/process_start_time_seconds (\d+(?:\.\d+)?)/)
      expect(m).not.toBeNull()
      const ts = Number(m![1])
      // 必须是过去或现在的时间，且在合理范围内（2020 年之后）
      expect(ts).toBeGreaterThan(1577836800)
      expect(ts).toBeLessThanOrEqual(Date.now() / 1000 + 1)
    })
  })
})
