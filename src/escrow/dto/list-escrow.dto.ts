import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator'

/** 查询担保订单列表：role=buyer / seller / all */
export class ListEscrowDto {
  @IsOptional()
  @IsString()
  @IsIn(['buyer', 'seller', 'all'])
  role?: 'buyer' | 'seller' | 'all'

  @IsOptional()
  @IsString()
  @IsIn(['CREATED', 'PAID', 'SHIPPED', 'RECEIVED', 'REFUND_REQUESTED', 'REFUNDED', 'DISPUTE', 'CANCELLED', 'EXPIRED'])
  status?: string
}
