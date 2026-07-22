import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  MaxLength,
  IsBoolean,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 发送站内消息（管理员/系统内部调用） */
export class SendMessageDto {
  @IsOptional()
  @IsString()
  userId?: string  // 不传或为空表示广播

  @IsString()
  @IsIn(['SYSTEM', 'TRANSACTION', 'PROMOTION', 'RISK'])
  category!: string

  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(128)
  title!: string

  @IsString()
  @IsNotEmpty({ message: '内容不能为空' })
  @MaxLength(2048)
  content!: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  link?: string

  @IsOptional()
  @IsString()
  @IsIn(['IN_APP', 'IN_APP,SMS', 'IN_APP,EMAIL', 'IN_APP,SMS,EMAIL'])
  channels?: string  // 默认 IN_APP

  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'NORMAL', 'HIGH'])
  priority?: string
}

/** 查询我的消息 */
export class ListMessageDto {
  @IsOptional()
  @IsString()
  @IsIn(['SYSTEM', 'TRANSACTION', 'PROMOTION', 'RISK'])
  category?: string

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  onlyUnread?: boolean

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number
}

/** 广播消息（管理员） */
export class BroadcastMessageDto {
  @IsString()
  @IsIn(['SYSTEM', 'TRANSACTION', 'PROMOTION', 'RISK'])
  category!: string

  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(128)
  title!: string

  @IsString()
  @IsNotEmpty({ message: '内容不能为空' })
  @MaxLength(2048)
  content!: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  link?: string

  @IsOptional()
  @IsString()
  @IsIn(['IN_APP', 'IN_APP,SMS', 'IN_APP,EMAIL', 'IN_APP,SMS,EMAIL'])
  channels?: string

  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'NORMAL', 'HIGH'])
  priority?: string
}
