import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ChannelReconciliationController } from './channel-reconciliation.controller'
import { ChannelReconciliationService } from './channel-reconciliation.service'
import { PermissionsGuard } from '../admin/permissions.guard'

/**
 * S5 多平台对账聚合模块
 *
 * 依赖：
 *  - PrismaModule（全局）
 *  - RedisModule（全局）
 *  - JwtModule（管理端 JWT 校验，与 AdminModule 一致使用 JWT_ADMIN_SECRET）
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ADMIN_SECRET')!,
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [ChannelReconciliationService, PermissionsGuard],
  controllers: [ChannelReconciliationController],
  exports: [ChannelReconciliationService],
})
export class ChannelReconciliationModule {}
