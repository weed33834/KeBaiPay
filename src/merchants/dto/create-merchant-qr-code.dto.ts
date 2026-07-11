import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class CreateMerchantQrCodeDto {
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  remark?: string
}
