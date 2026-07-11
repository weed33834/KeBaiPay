import { Global, Module } from '@nestjs/common'
import { ScheduleHealthService } from './schedule-health.service'

@Global()
@Module({
  providers: [ScheduleHealthService],
  exports: [ScheduleHealthService],
})
export class ScheduleHealthModule {}
