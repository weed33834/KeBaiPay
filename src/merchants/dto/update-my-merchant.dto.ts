import { IsOptional, IsString } from 'class-validator'

export class UpdateMyMerchantDto {
  @IsOptional()
  @IsString()
  merchantName?: string

  @IsOptional()
  @IsString()
  contactName?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsOptional()
  @IsString()
  settleAccount?: string

  @IsOptional()
  @IsString()
  businessLicenseNo?: string
}
