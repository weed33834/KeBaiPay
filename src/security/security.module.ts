import { Global, Module } from '@nestjs/common'
import { SecurityValidatorService } from './security-validator.service'

@Global()
@Module({
  providers: [SecurityValidatorService],
  exports: [SecurityValidatorService],
})
export class SecurityModule {}
