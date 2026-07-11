import { IsNumber, IsString, IsOptional, IsPositive, IsNotEmpty, Min, Max, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'

export class RechargeDto {
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  payPassword!: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
