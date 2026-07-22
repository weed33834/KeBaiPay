import {
  IsString,
  IsOptional,
  IsNotEmpty,
  MaxLength,
} from 'class-validator'

/** 订阅计划 */
export class SubscribeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  payPassword!: string
}

/** 取消订阅 */
export class CancelSubscriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string
}
