import { Module } from '@nestjs/common'
import { WithdrawalsService } from './withdrawals.service'
import { WithdrawalsSchedule } from './withdrawals.schedule'
import { WithdrawalsController } from './withdrawals.controller'
import { UsersModule } from '../users/users.module'
import { FinanceModule } from '../finance/finance.module'
import { CryptoModule } from '../crypto/crypto.module'

@Module({
  imports: [UsersModule, FinanceModule, CryptoModule],
  providers: [WithdrawalsService, WithdrawalsSchedule],
  controllers: [WithdrawalsController],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
