import { Module } from '@nestjs/common'
import { RedPacketsService } from './red-packets.service'
import { RedPacketsController } from './red-packets.controller'
import { RedPacketsSchedule } from './red-packets.schedule'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [RedPacketsService, RedPacketsSchedule],
  controllers: [RedPacketsController],
})
export class RedPacketsModule {}
