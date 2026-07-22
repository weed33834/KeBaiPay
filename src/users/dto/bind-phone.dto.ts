import { IsNotEmpty, IsString, Matches } from 'class-validator'

/** 绑定/换绑手机号：前端 /users/bind-phone 调用 */
export class BindPhoneDto {
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string

  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  code!: string
}
