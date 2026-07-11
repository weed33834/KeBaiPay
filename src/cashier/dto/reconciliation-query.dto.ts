import { IsOptional, Matches } from 'class-validator'

export class ReconciliationQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 格式应为 YYYY-MM-DD' })
  startDate?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 格式应为 YYYY-MM-DD' })
  endDate?: string
}
