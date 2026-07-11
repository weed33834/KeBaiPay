import { Module, Global } from '@nestjs/common'
import { MailerModule } from '@nestjs-modules/mailer'
import { ConfigService } from '@nestjs/config'
import { NotificationsService } from './notifications.service'
import { SettlementService } from './settlement.service'
import { SettlementSchedule } from './settlement.schedule'
import { PrismaModule } from '../prisma/prisma.module'

@Global()
@Module({
  imports: [
    PrismaModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('SMTP_HOST', 'smtp.ethereal.email'),
          port: config.get<number>('SMTP_PORT', 587),
          secure: false,
          auth: {
            user: config.get('SMTP_USER', ''),
            pass: config.get('SMTP_PASS', ''),
          },
        },
        defaults: {
          from: config.get('SMTP_FROM', 'KeBaiPay <noreply@kebaipay.com>'),
        },
      }),
    }),
  ],
  providers: [NotificationsService, SettlementService, SettlementSchedule],
  exports: [NotificationsService, SettlementService],
})
export class NotificationsModule {}
