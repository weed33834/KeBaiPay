import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsInt, Min } from 'class-validator'
import { AGENT_SCENARIOS } from '../../common/constants'

/** 创建智能体 */
export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  name!: string

  @IsString()
  @IsOptional()
  description?: string

  @IsIn(AGENT_SCENARIOS as readonly string[])
  scenario!: string

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[]
}

/** 更新智能体 */
export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  name?: string

  @IsString()
  @IsOptional()
  description?: string

  @IsIn(['ACTIVE', 'DISABLED'])
  @IsOptional()
  status?: string

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[]
}

/** 用户授权智能体 */
export class AuthorizeAgentDto {
  @IsString()
  @IsNotEmpty()
  agentId!: string

  @IsIn(['user', 'merchant'])
  subjectType!: 'user' | 'merchant'

  @IsString()
  @IsNotEmpty()
  subjectId!: string

  @IsArray()
  @IsString({ each: true })
  scopes!: string[]

  @IsInt()
  @Min(0)
  @IsOptional()
  maxAmount?: number

  @IsOptional()
  expiresAt?: Date
}

/** 发起对话 */
export class StartConversationDto {
  @IsString()
  @IsNotEmpty()
  scenario!: string

  @IsString()
  @IsOptional()
  title?: string

  @IsOptional()
  metadata?: Record<string, unknown>
}

/** 发送消息 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content!: string

  @IsString()
  @IsOptional()
  convId?: string
}

/** 确认/拒绝操作 */
export class ConfirmOpDto {
  @IsString()
  @IsNotEmpty()
  opLogId!: string

  @IsIn(['CONFIRM', 'REJECT'])
  decision!: 'CONFIRM' | 'REJECT'
}
