import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { maskBankCard } from '../common/mask'

/**
 * 敏感字段加密服务
 *
 * 使用 AES-256-GCM 对称加密，适用于身份证号、银行卡号等敏感数据的加密存储。
 * 密钥从环境变量 ENCRYPTION_KEY 派生，未配置时直接抛错拒绝启动（避免弱密钥加密敏感数据）。
 *
 * 存储格式：base64(iv:ciphertext:authTag)
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name)
  private key!: Buffer

  private readonly ALGORITHM = 'aes-256-gcm'
  private readonly IV_LENGTH = 12
  // salt 固定值：用于 scrypt 密钥派生，与历史密文兼容；轮换密钥需重新加密全量数据
  private readonly SALT = 'kebaipay-salt-v1'

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')
    if (!encryptionKey || encryptionKey.length < 32) {
      // 未配置或长度不足直接 fatal，避免开发环境误用弱密钥加密生产数据
      throw new Error(
        'ENCRYPTION_KEY 未配置或长度不足 32 字符，拒绝启动。请在 .env 中设置 32 字符以上的随机字符串。',
      )
    }
    this.key = scryptSync(encryptionKey, this.SALT, 32)
    this.logger.log('ENCRYPTION_KEY 已加载，敏感字段加密服务就绪')
  }

  /**
   * 加密明文
   * @returns base64(iv:ciphertext:authTag)
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(this.IV_LENGTH)
    const cipher = createCipheriv(this.ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
  }

  /**
   * 解密
   * @param encrypted base64(iv:ciphertext:authTag)
   */
  decrypt(encrypted: string): string {
    const buf = Buffer.from(encrypted, 'base64')
    const iv = buf.subarray(0, this.IV_LENGTH)
    const authTag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(this.IV_LENGTH, buf.length - 16)
    const decipher = createDecipheriv(this.ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  }

  /**
   * 脱敏显示：委托给 common/mask 统一实现
   * 保留首尾各几位，中间用 **** 替代
   */
  mask(value: string, headKeep = 4, tailKeep = 4): string {
    if (!value) return ''
    if (value.length <= headKeep + tailKeep) return '****'
    // 默认参数与 maskBankCard 一致，直接复用
    if (headKeep === 4 && tailKeep === 4) return maskBankCard(value)
    return `${value.slice(0, headKeep)}****${value.slice(-tailKeep)}`
  }
}
