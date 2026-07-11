import { IsIn, IsOptional, IsString } from 'class-validator'

export class AuditMerchantDto {
  @IsIn(['APPROVE', 'REJECT'])
  action!: 'APPROVE' | 'REJECT'

  @IsOptional()
  @IsString()
  reason?: string
}
