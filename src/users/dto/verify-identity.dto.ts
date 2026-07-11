import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator'

// 支付密码强度策略：6 位纯数字（与银行惯例一致），避免弱密码（如 123456、abcdef）
const PAY_PASSWORD_REGEX = /^\d{6}$/

export class VerifyIdentityDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(30)
  realName!: string

  @IsString()
  @IsNotEmpty()
  @MinLength(15)
  @MaxLength(18)
  idCard!: string

  @IsString()
  @IsNotEmpty()
  @Matches(PAY_PASSWORD_REGEX, {
    message: '支付密码必须为 6 位纯数字',
  })
  payPassword!: string
}
