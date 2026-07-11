import { IsNotEmpty, IsString } from 'class-validator'

export class SetSystemConfigDto {
  @IsString()
  @IsNotEmpty()
  key!: string

  @IsString()
  @IsNotEmpty()
  value!: string
}
