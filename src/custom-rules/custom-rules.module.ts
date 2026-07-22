import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { CustomRulesService } from './custom-rules.service'
import { CustomRulesController } from './custom-rules.controller'
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
  providers: [CustomRulesService, PermissionsGuard],
  controllers: [CustomRulesController],
  exports: [CustomRulesService],
})
export class CustomRulesModule {}
