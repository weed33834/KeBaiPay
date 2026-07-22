import {
  IsNumber,
  IsString,
  IsOptional,
  IsPositive,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * 买家创建担保订单
 * 创建时只产生订单记录，不扣款；买家调用 /pay 接口时才冻结资金
 */
export class CreateEscrowDto {
  @IsString()
  @IsNotEmpty({ message: '收款方 ID 不能为空' })
  sellerId!: string

  @IsNumber()
  @IsPositive({ message: '金额必须大于 0' })
  @Min(0.01, { message: '金额必须大于 0' })
  @Max(500000, { message: '单笔担保交易金额上限 5000 元' })
  @Type(() => Number)
  amount!: number

  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(128)
  subject!: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  body?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string
}
