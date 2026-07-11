import { Module, Global } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';

@Global()
@Module({
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
