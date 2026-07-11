import { Type } from 'class-transformer'
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'

export class RefundDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount?: number

  @IsOptional()
  @IsString()
  reason?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
