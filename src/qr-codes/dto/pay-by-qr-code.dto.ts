import { IsString, IsNumber, IsOptional, IsPositive, IsNotEmpty, Min, Max, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'

export class PayByQrCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount?: number

  @IsOptional()
  @IsString()
  remark?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  payPassword!: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
