import { Module } from '@nestjs/common'
import { WebhooksController } from './webhooks.controller'
import { WebhooksService } from './webhooks.service'
import { TransactionsModule } from '../transactions/transactions.module'
import { WithdrawalsModule } from '../withdrawals/withdrawals.module'
import { PaymentChannelsModule } from '../payment-channels/payment-channels.module'
import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../redis/redis.module'

@Module({
  imports: [
    TransactionsModule,
    WithdrawalsModule,
    PaymentChannelsModule,
    PrismaModule,
    RedisModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
