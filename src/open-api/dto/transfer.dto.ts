import { Type } from 'class-transformer'
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  toUserId!: string

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  remark?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
