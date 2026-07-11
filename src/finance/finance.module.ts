import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { PrismaModule } from '../prisma/prisma.module'
import { FinanceService } from './finance.service'
import { ReconciliationService } from './reconciliation.service'
import { FinanceController } from './finance.controller'
import { ReconciliationController } from './reconciliation.controller'
import { FinanceSchedule } from './finance.schedule'
import { ReconciliationSchedule } from './reconciliation.schedule'
import { JournalService } from './journal.service'

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1h') as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'],
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    FinanceService,
    ReconciliationService,
    FinanceSchedule,
    ReconciliationSchedule,
    JournalService,
  ],
  controllers: [FinanceController, ReconciliationController],
  exports: [FinanceService, ReconciliationService, JournalService],
})
export class FinanceModule {}
