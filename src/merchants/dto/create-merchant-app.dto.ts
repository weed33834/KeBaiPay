import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class CreateMerchantAppDto {
  @IsString()
  @IsNotEmpty()
  name!: string

  @IsOptional()
  @IsString()
  callbackUrl?: string
}
