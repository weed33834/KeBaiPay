import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { HealthService } from './health.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { ChannelHealthService } from '../payment-channels/channel-health.service'

/**
 * 健康检查端点。
 *
 * @SkipThrottler：探针端点不受全局限流，避免 k8s 高频 probe 触发 429 影响真实请求。
 * 探针返回原始结构，不走 ResponseTransformInterceptor 包装（见 interceptor 的跳过逻辑），
 * 确保 k8s/docker 按状态码与 status 字段判断存活。
 */
@ApiTags('健康检查')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly scheduleHealthService: ScheduleHealthService,
    private readonly channelHealthService: ChannelHealthService,
  ) {}

  @Get()
  @ApiOperation({ summary: '存活探针（liveness）' })
  @HttpCode(HttpStatus.OK)
  async liveness() {
    return this.healthService.liveness()
  }

  @Get('ready')
  @ApiOperation({ summary: '就绪探针（readiness），检查 DB 与 Redis' })
  async readiness() {
    const result = await this.healthService.readiness()
    // readiness 故障时返回 503：k8s readiness probe 按状态码摘除 Pod，
    // 不摘除会导致流量继续打到故障实例。
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException({ status: 'error', timestamp: result.timestamp })
    }
    return result
  }

  @Get('schedules')
  @ApiOperation({ summary: '调度任务健康状态' })
  getSchedules() {
    return this.scheduleHealthService.getScheduleStatus()
  }

  @Get('channels')
  @ApiOperation({ summary: '支付渠道健康状态' })
  getChannelHealth() {
    return this.channelHealthService.getAllChannelHealth()
  }

  @Get('channels/summary')
  @ApiOperation({ summary: '支付渠道健康摘要' })
  getChannelHealthSummary() {
    return this.channelHealthService.getHealthSummary()
  }
}
