import { Type } from 'class-transformer'
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  adminId?: string

  @IsOptional()
  @IsString()
  action?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 格式应为 YYYY-MM-DD' })
  startDate?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 格式应为 YYYY-MM-DD' })
  endDate?: string

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
