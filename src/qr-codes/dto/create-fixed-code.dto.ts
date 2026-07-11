import { IsNumber, IsString, IsOptional, IsPositive, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateFixedCodeDto {
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  remark?: string
}
