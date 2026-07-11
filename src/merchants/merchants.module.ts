import { Module } from '@nestjs/common'
import { MerchantsService } from './merchants.service'
import { MerchantsController } from './merchants.controller'
import { MerchantConfigController } from '../merchant/merchant-config.controller'
import { CryptoModule } from '../crypto/crypto.module'

@Module({
  imports: [CryptoModule],
  providers: [MerchantsService],
  controllers: [MerchantsController, MerchantConfigController],
  exports: [MerchantsService],
})
export class MerchantsModule {}
