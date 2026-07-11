import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
import { PaymentChannelsModule } from '../payment-channels/payment-channels.module'

@Module({
  imports: [PaymentChannelsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
