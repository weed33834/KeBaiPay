import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator'

/** 买家申请退款 / 买家发起争议 */
export class EscrowReasonDto {
  @IsString()
  @IsNotEmpty({ message: '原因不能为空' })
  @MaxLength(512)
  reason!: string
}

/** 卖家同意退款 / 管理员裁决 */
export class EscrowResolveDto {
  @IsString()
  @IsNotEmpty({ message: '决定必须明确' })
  @MaxLength(32)
  // APPROVE_REFUND（同意退款） / REJECT_REFUND（拒绝退款，资金放给卖家）
  decision!: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string
}
