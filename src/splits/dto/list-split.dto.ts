import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

/** 分账列表查询 */
export class ListSplitDto {
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: string

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
