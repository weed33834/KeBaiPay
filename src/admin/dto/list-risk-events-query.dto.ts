import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
} from 'class-validator'
import { RiskLevel } from '../../common/enums'

export class ListRiskEventsQueryDto {
  @IsOptional()
  @IsEnum(RiskLevel)
  level?: RiskLevel

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  handled?: boolean

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
