import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 创建风控审计会话 */
export class CreateRiskAuditSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string
}

/** 发送消息 */
export class SendMessageDto {
  @IsString()
  @MaxLength(2000)
  content!: string
}

/** 关闭会话 */
export class CloseSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string
}

/** 列表查询 */
export class ListRiskAuditSessionDto {
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
