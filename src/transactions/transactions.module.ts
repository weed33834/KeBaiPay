import { Module } from '@nestjs/common'
import { TransactionsService } from './transactions.service'
import { TransactionsSchedule } from './transactions.schedule'
import { TransactionsController } from './transactions.controller'
import { UsersModule } from '../users/users.module'
import { FinanceModule } from '../finance/finance.module'

@Module({
  imports: [UsersModule, FinanceModule],
  providers: [TransactionsService, TransactionsSchedule],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}
