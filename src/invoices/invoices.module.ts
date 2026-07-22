import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { InvoicesService } from './invoices.service'
import { InvoicesController } from './invoices.controller'
import { PermissionsGuard } from '../admin/permissions.guard'

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
  ],
  providers: [InvoicesService, PermissionsGuard],
  controllers: [InvoicesController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
