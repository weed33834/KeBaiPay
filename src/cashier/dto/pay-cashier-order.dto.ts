import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class PayCashierOrderDto {
  @IsString()
  @IsNotEmpty()
  payPassword!: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
