import { Type } from 'class-transformer'
import { IsEnum, IsNumber, IsOptional } from 'class-validator'
import { WithdrawalStatus } from '../../common/enums'

export class ListWithdrawalsQueryDto {
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
