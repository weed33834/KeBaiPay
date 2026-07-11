import { IsNumber, IsString, IsOptional, IsPositive, IsNotEmpty, Min, Max, MaxLength, Matches } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateWithdrawalDto {
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
  @Matches(/^\d{12,19}$/, { message: '银行卡号格式不正确' })
  channelAccount?: string

  @IsOptional()
  @IsString()
  remark?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
