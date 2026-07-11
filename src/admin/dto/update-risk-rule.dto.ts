import { IsBoolean, IsEnum, IsObject, IsOptional, IsString } from 'class-validator'

export class UpdateRiskRuleDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsEnum(['BLOCK', 'WARN', 'REVIEW'] as const)
  action?: 'BLOCK' | 'WARN' | 'REVIEW'

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>
}
