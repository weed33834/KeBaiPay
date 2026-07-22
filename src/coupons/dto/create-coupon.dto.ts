import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  IsIn,
  IsDateString,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 创建优惠券 */
export class CreateCouponDto {
  @IsString()
  @IsNotEmpty({ message: '优惠券名称不能为空' })
  @MaxLength(128)
  name!: string

  @IsString()
  @IsIn(['FIXED', 'PERCENT'])
  type!: string

  // FIXED: 元（0.01-1000）；PERCENT: 百分比 1-99
  @IsNumber()
  @Min(0.01, { message: '面值必须大于 0' })
  @Max(100, { message: '面值/百分比上限 100' })
  @Type(() => Number)
  value!: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minAmountYuan?: number  // 满减门槛，元

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  totalQuota?: number  // 发放总量，0=不限

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  perUserLimit?: number  // 单用户领取上限

  @IsOptional()
  @IsDateString()
  expiresAt?: string
}

/** 修改优惠券状态 */
export class UpdateCouponStatusDto {
  @IsString()
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: string
}

/** 使用用户优惠券 */
export class UseUserCouponDto {
  @IsString()
  @IsNotEmpty({ message: '订单号不能为空' })
  orderNo!: string

  // 实际订单金额（元），用于校验是否满足满减门槛
  @IsInt()
  @Min(1)
  @Type(() => Number)
  orderAmount!: number
}
