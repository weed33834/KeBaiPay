import { Type } from 'class-transformer'
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator'

export class CreateOpenApiOrderDto {
  @IsString()
  @IsNotEmpty()
  merchantOrderNo!: string

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number

  @IsString()
  @IsNotEmpty()
  subject!: string

  @IsOptional()
  @IsString()
  body?: string

  @IsOptional()
  @IsString()
  callbackUrl?: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/, {
    message: 'expiredAt 格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss',
  })
  expiredAt?: string
}
