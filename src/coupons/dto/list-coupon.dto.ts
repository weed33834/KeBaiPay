import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

/** 优惠券列表查询 */
export class ListCouponDto {
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'DISABLED'])
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

/** 用户优惠券列表查询 */
export class ListUserCouponDto {
  @IsOptional()
  @IsString()
  @IsIn(['AVAILABLE', 'USED', 'EXPIRED'])
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
