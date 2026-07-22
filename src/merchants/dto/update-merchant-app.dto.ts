import { IsEmpty, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator'

/** 更新商户应用：前端 PATCH /merchants/apps/:appId 调用 */
export class UpdateMerchantAppDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '应用名称不能为空' })
  @MaxLength(64)
  name?: string

  @IsOptional()
  @IsString()
  // 空字符串视为「清空」：跳过 URL 格式校验
  @ValidateIf((o) => o.callbackUrl && o.callbackUrl.length > 0)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: '回调地址格式不正确' })
  callbackUrl?: string
}
