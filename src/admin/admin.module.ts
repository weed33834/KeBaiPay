import { Module, OnModuleInit } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AdminService } from './admin.service'
import { AdminController } from './admin.controller'
import { AdminAuthService } from './admin-auth.service'
import { AdminAuthController } from './admin-auth.controller'
import { AdminUserController } from './admin-user.controller'
import { SystemConfigController } from './system-config.controller'
import { ChannelConfigController } from './channel-config.controller'
import { PermissionsGuard } from './permissions.guard'
import { FinanceModule } from '../finance/finance.module'
import { WithdrawalsModule } from '../withdrawals/withdrawals.module'
import { MerchantsModule } from '../merchants/merchants.module'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ADMIN_SECRET')!,
        signOptions: {
          expiresIn: config.get<string>('JWT_ADMIN_EXPIRES_IN', '1h') as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'],
        },
      }),
      inject: [ConfigService],
    }),
    FinanceModule,
    WithdrawalsModule,
    MerchantsModule,
  ],
  providers: [AdminService, AdminAuthService, PermissionsGuard],
  controllers: [
    AdminController,
    AdminAuthController,
    AdminUserController,
    SystemConfigController,
    ChannelConfigController,
  ],
})
export class AdminModule implements OnModuleInit {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  async onModuleInit() {
    await this.adminAuthService.seedAdmin()
  }
}
