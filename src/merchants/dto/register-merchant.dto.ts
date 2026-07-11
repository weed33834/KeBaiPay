import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { MerchantType } from '../../common/enums'

export class RegisterMerchantDto {
  @IsString()
  @IsNotEmpty()
  merchantName!: string

  @IsOptional()
  @IsEnum(MerchantType)
  merchantType?: MerchantType

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
