import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

/** 订阅列表查询 */
export class ListSubscriptionDto {
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'])
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

/** 订阅扣款记录列表查询 */
export class ListSubscriptionChargeDto {
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'SUCCESS', 'FAILED'])
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
