import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

/** 批量转账列表查询 */
export class ListBatchTransferDto {
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'])
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
