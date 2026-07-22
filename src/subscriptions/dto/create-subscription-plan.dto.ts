import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  IsIn,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 创建订阅计划 */
export class CreateSubscriptionPlanDto {
  @IsString()
  @IsNotEmpty({ message: '计划名称不能为空' })
  @MaxLength(128)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string

  @IsNumber()
  @Min(0.01, { message: '每期金额必须大于 0' })
  @Max(10000, { message: '每期金额上限 10000 元' })
  @Type(() => Number)
  amount!: number

  @IsString()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
  period!: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  intervalCount?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  trialDays?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  totalCycles?: number
}
