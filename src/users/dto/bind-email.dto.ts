import { IsEmail, IsNotEmpty, IsString } from 'class-validator'

/** 绑定/换绑邮箱：前端 /users/bind-email 调用 */
export class BindEmailDto {
  @IsString()
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  code!: string
}
