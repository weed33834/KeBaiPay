import { IsNotEmpty, IsString, MinLength } from 'class-validator'

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string
}
