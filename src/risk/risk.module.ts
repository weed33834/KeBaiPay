import { Global, Module } from '@nestjs/common'
import { RiskEngineService } from './risk-engine.service'

@Global()
@Module({
  providers: [RiskEngineService],
  exports: [RiskEngineService],
})
export class RiskModule {}
