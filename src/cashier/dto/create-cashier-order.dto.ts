import { Type } from 'class-transformer'
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'

export class CreateCashierOrderDto {
  @IsString()
  @IsNotEmpty()
  merchantOrderNo!: string

  @IsNumber()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsString()
  @IsNotEmpty()
  subject!: string

  @IsOptional()
  @IsString()
  body?: string

  @IsOptional()
  @IsString()
  callbackUrl?: string

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiredAt?: Date
}
