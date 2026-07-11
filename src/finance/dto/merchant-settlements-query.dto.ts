import { IsOptional, IsString } from 'class-validator'
import { DateRangeQueryDto } from './date-range-query.dto'

export class MerchantSettlementsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  merchantId?: string
}
