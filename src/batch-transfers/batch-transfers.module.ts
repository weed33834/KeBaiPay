import { Module } from '@nestjs/common'
import { BatchTransfersService } from './batch-transfers.service'
import { BatchTransfersController } from './batch-transfers.controller'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [BatchTransfersService],
  controllers: [BatchTransfersController],
  exports: [BatchTransfersService],
})
export class BatchTransfersModule {}
