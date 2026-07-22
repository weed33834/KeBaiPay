import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import {
  ChannelStatementItemType,
  ChannelStatementStatus,
  MatchStatus,
  ReconciliationDiffStatus,
  ReconciliationDiffType,
} from '../../common/enums'

/** 拉取渠道对账单 */
export class FetchStatementDto {
  @IsString()
  @IsNotEmpty({ message: '渠道编码不能为空' })
  @MaxLength(32)
  channelCode!: string

  /** YYYY-MM-DD */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式必须为 YYYY-MM-DD' })
  date!: string
}

/** 查询渠道对账单列表 */
export class ListStatementsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  channelCode?: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string

  @IsOptional()
  @IsEnum(ChannelStatementStatus)
  status?: ChannelStatementStatus

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20
}

/** 查询对账单条目列表 */
export class ListStatementItemsQueryDto {
  @IsOptional()
  @IsEnum(ChannelStatementItemType)
  type?: ChannelStatementItemType

  @IsOptional()
  @IsEnum(MatchStatus)
  matchStatus?: MatchStatus

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelOrderNo?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50
}

/** 查询差异项列表 */
export class ListDifferencesQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  reportDate?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  channelCode?: string

  @IsOptional()
  @IsEnum(ReconciliationDiffType)
  diffType?: ReconciliationDiffType

  @IsOptional()
  @IsEnum(ReconciliationDiffStatus)
  status?: ReconciliationDiffStatus

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedTo?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20
}

/** 指派差异处理人 */
export class AssignDifferenceDto {
  @IsString()
  @IsNotEmpty({ message: '处理人不能为空' })
  @MaxLength(64)
  assignedTo!: string
}

/** 解决差异 */
export class ResolveDifferenceDto {
  @IsString()
  @IsNotEmpty({ message: '解决方案不能为空' })
  @MaxLength(512)
  resolution!: string

  /** 解决方式：RESOLVED 或 IGNORED */
  @IsOptional()
  @IsEnum(ReconciliationDiffStatus)
  finalStatus?: ReconciliationDiffStatus
}
