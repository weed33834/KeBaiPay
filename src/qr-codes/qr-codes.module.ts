import { Module } from '@nestjs/common'
import { QrCodesService } from './qr-codes.service'
import { QrCodesController } from './qr-codes.controller'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [QrCodesService],
  controllers: [QrCodesController],
  exports: [QrCodesService],
})
export class QrCodesModule {}
