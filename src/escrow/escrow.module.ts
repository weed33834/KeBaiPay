import { Module } from '@nestjs/common'
import { EscrowService } from './escrow.service'
import { EscrowController } from './escrow.controller'
import { EscrowSchedule } from './escrow.schedule'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [EscrowService, EscrowSchedule],
  controllers: [EscrowController],
  exports: [EscrowService],
})
export class EscrowModule {}
