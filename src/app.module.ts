import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { join } from 'path'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { AccountsModule } from './accounts/accounts.module'
import { TransactionsModule } from './transactions/transactions.module'
import { TransfersModule } from './transfers/transfers.module'
import { BillsModule } from './bills/bills.module'
import { WithdrawalsModule } from './withdrawals/withdrawals.module'
import { RedPacketsModule } from './red-packets/red-packets.module'
import { QrCodesModule } from './qr-codes/qr-codes.module'
import { MerchantsModule } from './merchants/merchants.module'
import { PrismaModule } from './prisma/prisma.module'
import { CashierModule } from './cashier/cashier.module'
import { OpenApiModule } from './open-api/open-api.module'
import { AdminModule } from './admin/admin.module'
import { FinanceModule } from './finance/finance.module'
import { RedisModule } from './redis/redis.module'
import { PaymentChannelsModule } from './payment-channels/payment-channels.module'
import { WebhooksModule } from './webhooks/webhooks.module'
import { CryptoModule } from './crypto/crypto.module'
import { SecurityModule } from './security/security.module'
import { RiskModule } from './risk/risk.module'
import { AuditModule } from './audit/audit.module'
import { HealthModule } from './health/health.module'
import { NotificationsModule } from './notifications/notifications.module'
import { SmsModule } from './sms/sms.module'
import { RequestLoggingMiddleware } from './common/request-logging.middleware'
import { ScheduleHealthModule } from './common/schedule-health.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'auth',
        ttl: 60000,
        limit: 10,
      },
      {
        name: 'open-api',
        ttl: 60000,
        limit: 30,
      },
    ]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    SecurityModule,
    RiskModule,
    AuditModule,
    PaymentChannelsModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    TransactionsModule,
    TransfersModule,
    BillsModule,
    WithdrawalsModule,
    RedPacketsModule,
    QrCodesModule,
    MerchantsModule,
    CashierModule,
    OpenApiModule,
    AdminModule,
    FinanceModule,
    WebhooksModule,
    NotificationsModule,
    HealthModule,
    ScheduleHealthModule,
    SmsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggingMiddleware)
      .forRoutes('*')
  }
}
