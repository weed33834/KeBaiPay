import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 单个分账接收方 */
export class SplitReceiverDto {
  @IsString()
  @IsNotEmpty({ message: '收款方 ID 不能为空' })
  receiverId!: string

  @IsNumber()
  @Min(0.01, { message: '分账金额必须大于 0' })
  @Max(10000, { message: '单笔分账金额上限 10000 元' })
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  @MaxLength(256)
  remark?: string
}

/** 创建分账订单 */
export class CreateSplitDto {
  @IsString()
  @IsNotEmpty({ message: '源订单号不能为空' })
  sourceOrderNo!: string

  @IsArray()
  @ArrayMinSize(1, { message: '至少包含 1 个分账接收方' })
  @ArrayMaxSize(50, { message: '最多 50 个分账接收方' })
  @ValidateNested({ each: true })
  @Type(() => SplitReceiverDto)
  receivers!: SplitReceiverDto[]

  @IsOptional()
  @IsString()
  @MaxLength(256)
  remark?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string
}
