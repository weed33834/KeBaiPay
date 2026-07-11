import { Type } from 'class-transformer'
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator'
import { UserStatus } from '../../common/enums'

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10
}
