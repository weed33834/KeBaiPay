import { IsString, IsOptional, IsNotEmpty, MaxLength, MinLength } from 'class-validator'

export class LoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  password!: string
}
