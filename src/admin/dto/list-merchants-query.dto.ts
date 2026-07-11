import { Type } from 'class-transformer'
import { IsEnum, IsNumber, IsOptional } from 'class-validator'
import { MerchantStatus } from '../../common/enums'

export class ListMerchantsQueryDto {
  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
