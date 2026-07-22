import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

/** 修改登录密码：前端 /users/change-password 调用 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '原密码不能为空' })
  oldPassword!: string

  @IsString()
  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(8, { message: '新密码至少 8 位' })
  @MaxLength(64, { message: '新密码最长 64 位' })
  newPassword!: string
}
