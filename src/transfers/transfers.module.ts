import { Module } from '@nestjs/common'
import { TransfersService } from './transfers.service'
import { TransfersController } from './transfers.controller'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [TransfersService],
  controllers: [TransfersController],
  exports: [TransfersService],
})
export class TransfersModule {}
