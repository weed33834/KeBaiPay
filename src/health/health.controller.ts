import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { HealthService } from './health.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { ChannelHealthService } from '../payment-channels/channel-health.service'

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly scheduleHealthService: ScheduleHealthService,
    private readonly channelHealthService: ChannelHealthService,
  ) {}

  @Get()
  @ApiOperation({ summary: '存活探针（liveness）' })
  async liveness() {
    return this.healthService.liveness()
  }

  @Get('ready')
  @ApiOperation({ summary: '就绪探针（readiness），检查 DB 与 Redis' })
  async readiness() {
    return this.healthService.readiness()
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
