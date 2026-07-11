import { Module } from '@nestjs/common'
import { OpenApiService } from './open-api.service'
import { OpenApiController } from './open-api.controller'
import { OpenApiGuard } from './open-api.guard'

@Module({
  providers: [OpenApiService, OpenApiGuard],
  controllers: [OpenApiController],
})
export class OpenApiModule {}
