import { Module } from '@nestjs/common'
import { SubscriptionsService } from './subscriptions.service'
import { SubscriptionsController } from './subscriptions.controller'
import { SubscriptionsSchedule } from './subscriptions.schedule'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [SubscriptionsService, SubscriptionsSchedule],
  controllers: [SubscriptionsController],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
