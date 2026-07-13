import { Module } from '@nestjs/common'
import { MerchantsService } from './merchants.service'
import { MerchantsController } from './merchants.controller'
import { CryptoModule } from '../crypto/crypto.module'

@Module({
  imports: [CryptoModule],
  providers: [MerchantsService],
  controllers: [MerchantsController],
  exports: [MerchantsService],
})
export class MerchantsModule {}
