import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { MetricsService } from './metrics.service'

/**
 * Prometheus 指标暴露端点
 *
 * /metrics 返回 Prometheus 文本格式指标，供 Prometheus server 定期抓取。
 * @SkipThrottle 避免抓取被限流；不经过 ResponseTransformInterceptor 包装，
 * 直接返回纯文本，否则会破坏 Prometheus 解析。
 *
 * 生产环境建议通过反向代理或网络策略限制 /metrics 仅内网可访问，
 * 避免暴露内部运行时指标给公网。
 */
@ApiTags('可观测性')
@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus 指标（供 Prometheus server 抓取）' })
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.metricsService.metrics()
  }
}
