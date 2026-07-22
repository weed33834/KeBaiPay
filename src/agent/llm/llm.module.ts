import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { LlmService } from './llm.service'

/**
 * LLM 全局模块：
 *  - 封装 Vercel AI SDK 的调用细节
 *  - mock 模式下零依赖降级
 *  - 通过 @Global 暴露给所有 Agent 场景模块使用
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
