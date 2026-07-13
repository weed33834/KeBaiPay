import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { MetricsService } from './metrics.service'
import { MetricsController } from './metrics.controller'
import { MetricsInterceptor } from './metrics.interceptor'

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    // 全局拦截器：所有 HTTP 请求自动采集指标
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
