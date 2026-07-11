import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString } from 'class-validator'

export class ListLoginLogsQueryDto {
  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
