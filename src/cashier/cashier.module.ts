import { Module } from '@nestjs/common'
import { CashierService } from './cashier.service'
import { CashierSchedule } from './cashier.schedule'
import { CashierController, CashierQrCodeController } from './cashier.controller'
import { UsersModule } from '../users/users.module'
import { FinanceModule } from '../finance/finance.module'

@Module({
  imports: [UsersModule, FinanceModule],
  providers: [CashierService, CashierSchedule],
  controllers: [CashierController, CashierQrCodeController],
})
export class CashierModule {}
