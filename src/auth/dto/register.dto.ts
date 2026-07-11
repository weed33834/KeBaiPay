import { IsString, IsOptional, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator'

// 登录密码强度策略：至少 8 位，必须包含大写字母、小写字母、数字中至少两类。
// 采用正向断言组合，覆盖 (小写+大写) | (小写+数字) | (大写+数字) 三种满足条件。
const LOGIN_PASSWORD_REGEX =
  /^(?:(?=.*[a-z])(?=.*[A-Z])|(?=.*[a-z])(?=.*\d)|(?=.*[A-Z])(?=.*\d)).{8,64}$/

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(32)
  nickname!: string

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
  @Matches(LOGIN_PASSWORD_REGEX, {
    message: '密码至少 8 位，且必须包含大写字母、小写字母、数字中的至少两类',
  })
  password!: string
}
