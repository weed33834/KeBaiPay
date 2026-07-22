import { Module } from '@nestjs/common'
import { SplitsService } from './splits.service'
import { SplitsController } from './splits.controller'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [SplitsService],
  controllers: [SplitsController],
  exports: [SplitsService],
})
export class SplitsModule {}
