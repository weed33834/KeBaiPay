import { Type } from 'class-transformer'
import { IsNumber, IsOptional, Min } from 'class-validator'

export class UpdateMerchantConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  payRate?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  withdrawRate?: number

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  dailyLimit?: number
}
