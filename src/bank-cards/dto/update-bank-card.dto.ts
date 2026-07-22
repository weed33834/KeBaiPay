import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import type { BankCardType } from './create-bank-card.dto'

export class UpdateBankCardDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  holderName?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankName?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  branchName?: string

  @IsOptional()
  @IsIn(['DEBIT', 'CREDIT'])
  cardType?: BankCardType

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean
}
