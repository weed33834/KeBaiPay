import { IsEnum, IsOptional } from 'class-validator'
import { Transform } from 'class-transformer'
import { BillDirection } from '../../common/enums'

export class ListBillsQueryDto {
  @IsOptional()
  @IsEnum(BillDirection)
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  direction?: BillDirection
}
