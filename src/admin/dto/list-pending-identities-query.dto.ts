import { Type } from 'class-transformer'
import { IsNumber, IsOptional } from 'class-validator'

export class ListPendingIdentitiesQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 50
}
