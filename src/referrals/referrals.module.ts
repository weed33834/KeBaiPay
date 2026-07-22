import { Module } from '@nestjs/common'
import { ReferralsService } from './referrals.service'
import { ReferralsController } from './referrals.controller'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [ReferralsService],
  controllers: [ReferralsController],
  exports: [ReferralsService],
})
export class ReferralsModule {}
