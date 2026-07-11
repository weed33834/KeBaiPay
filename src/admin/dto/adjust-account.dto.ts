import { IsNotEmpty, IsNumber, IsString } from 'class-validator'

export class AdjustAccountDto {
  @IsNumber()
  amount!: number

  @IsString()
  @IsNotEmpty()
  reason!: string
}
