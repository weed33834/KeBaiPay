import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

/** 银行卡类型：借记卡 / 信用卡 */
export type BankCardType = 'DEBIT' | 'CREDIT'

/**
 * 绑卡请求 DTO
 * 字段与前端 public/app.js renderBankCards 中的 api('/bank-cards', { body: ... }) 调用一致
 */
export class CreateBankCardDto {
  @IsString()
  @IsNotEmpty({ message: '持卡人姓名不能为空' })
  @MaxLength(64)
  holderName!: string

  @IsString()
  @IsNotEmpty({ message: '银行卡号不能为空' })
  // 16~19 位数字（国内借记/信用卡通用）
  @Matches(/^\d{15,19}$/, { message: '银行卡号必须为 15-19 位数字' })
  cardNumber!: string

  @IsString()
  @IsNotEmpty({ message: '银行名称不能为空' })
  @MaxLength(64)
  bankName!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  branchName?: string

  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/, { message: '预留手机号格式不正确' })
  phone?: string

  @IsOptional()
  @IsIn(['DEBIT', 'CREDIT'])
  cardType?: BankCardType

  @IsOptional()
  isDefault?: boolean
}
