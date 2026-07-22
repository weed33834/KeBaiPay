import { IsNumber, IsString, IsOptional, IsPositive, IsNotEmpty, Min, Max, MaxLength, IsEnum, IsInt, MinLength } from 'class-validator'
import { Type } from 'class-transformer'
import { RedPacketType } from '../../common/enums'

export class CreateRedPacketDto {
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  @MaxLength(80)
  remark?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  payPassword!: string

  /**
   * 红包类型：
   * - LUCKY（默认）：拼手气红包，金额随机分配给多人
   * - ORDINARY：普通红包，每人固定金额（perAmount）
   * - EXCLUSIVE：专属红包，指定 designatedReceiverId 领取
   * - PASSWORD：口令红包，需输入 password 领取
   *
   * 不指定 type 时默认 LUCKY + totalCount=1，行为兼容旧版一对一红包
   */
  @IsOptional()
  @IsEnum(RedPacketType)
  type?: RedPacketType

  /**
   * 群红包总数量。LUCKY/ORDINARY 类型支持 >1，EXCLUSIVE/PASSWORD 仅允许 1
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  totalCount?: number

  /**
   * 普通红包每人金额（ORDINARY 必填，单位元）。
   * 总额 = perAmount × totalCount，需等于 amount
   */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  perAmount?: number

  /**
   * 口令红包口令（PASSWORD 必填，4-20 字符）
   */
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  password?: string

  /**
   * 专属红包指定收款人 ID（EXCLUSIVE 必填）
   */
  @IsOptional()
  @IsString()
  designatedReceiverId?: string

  /**
   * 幂等键（可选）。相同 key 重复请求时返回已创建的红包
   */
  @IsOptional()
  @IsString()
  idempotencyKey?: string
}

export class ReceiveRedPacketDto {
  /**
   * 口令红包口令（PASSWORD 类型必填）
   */
  @IsOptional()
  @IsString()
  password?: string
}
