import { IsString, IsNotEmpty, MaxLength } from 'class-validator'

/** 买家付款（冻结资金） */
export class PayEscrowDto {
  @IsString()
  @IsNotEmpty({ message: '支付密码不能为空' })
  @MaxLength(64)
  payPassword!: string
}
