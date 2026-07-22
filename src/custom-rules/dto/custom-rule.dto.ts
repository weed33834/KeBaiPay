import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsArray,
  ValidateNested,
  IsEnum,
  IsIn,
  IsDefined,
  Allow,
} from 'class-validator'
import { Type } from 'class-transformer'
import {
  CustomRuleField,
  CustomRuleOperator,
  CustomRuleLogicalOp,
} from '../../common/enums'

/** 条件单元 */
export class RuleConditionDto {
  @IsEnum(CustomRuleField)
  field!: CustomRuleField

  @IsEnum(CustomRuleOperator)
  operator!: CustomRuleOperator

  // value 类型多样：number/string/array，使用 Allow 让 ValidationPipe 接受任意值
  @Allow()
  value: any
}

/** 创建自定义规则 */
export class CreateCustomRuleDto {
  @IsString()
  @MaxLength(100)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsIn(['BLOCK', 'WARN', 'REVIEW'])
  action?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions!: RuleConditionDto[]

  @IsOptional()
  @IsEnum(CustomRuleLogicalOp)
  logicalOp?: CustomRuleLogicalOp
}

/** 更新自定义规则 */
export class UpdateCustomRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsIn(['BLOCK', 'WARN', 'REVIEW'])
  action?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions?: RuleConditionDto[]

  @IsOptional()
  @IsEnum(CustomRuleLogicalOp)
  logicalOp?: CustomRuleLogicalOp
}

/** 测试规则 */
export class TestRuleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions!: RuleConditionDto[]

  @IsOptional()
  @IsEnum(CustomRuleLogicalOp)
  logicalOp?: CustomRuleLogicalOp

  // 测试输入：模拟一次交易的上下文
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number

  @IsOptional()
  @IsString()
  type?: string

  @IsOptional()
  @IsString()
  ip?: string

  @IsOptional()
  @IsString()
  userRiskLevel?: string
}

/** 列表查询 */
export class ListCustomRuleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  action?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
