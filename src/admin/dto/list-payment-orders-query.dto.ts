import { Type } from 'class-transformer'
import { IsEnum, IsNumber, IsOptional } from 'class-validator'
import { PaymentOrderStatus } from '../../common/enums'

export class ListPaymentOrdersQueryDto {
  @IsOptional()
  @IsEnum(PaymentOrderStatus)
  status?: PaymentOrderStatus

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
