import { Module } from '@nestjs/common'
import { CouponsService } from './coupons.service'
import { CouponsController } from './coupons.controller'
import { CouponsSchedule } from './coupons.schedule'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [CouponsService, CouponsSchedule],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
