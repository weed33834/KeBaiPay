import { IsEnum, IsOptional, Matches } from 'class-validator'
import { PaymentOrderStatus } from '../../common/enums'

export class ExportOrdersQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 格式应为 YYYY-MM-DD' })
  startDate?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 格式应为 YYYY-MM-DD' })
  endDate?: string

  @IsOptional()
  @IsEnum(PaymentOrderStatus)
  status?: PaymentOrderStatus
}
