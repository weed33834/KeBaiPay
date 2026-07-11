import { IsEnum } from 'class-validator'
import { RiskLevel } from '../../common/enums'

export class UpdateUserRiskLevelDto {
  @IsEnum(RiskLevel)
  level!: RiskLevel
}
