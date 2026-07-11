import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * 敏感字段加密服务
 *
 * 使用 AES-256-GCM 对称加密，适用于身份证号、银行卡号等敏感数据的加密存储。
 * 密钥从环境变量 ENCRYPTION_KEY 派生，生产环境必须配置。
 *
 * 存储格式：base64(iv:ciphertext:authTag)
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name)
  private readonly key: Buffer

  private readonly ALGORITHM = 'aes-256-gcm'
  private readonly IV_LENGTH = 12
  private readonly SALT = 'kebaipay-salt-v1'

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')
    if (!encryptionKey) {
      // 开发环境允许使用默认密钥，生产环境必须配置
      this.logger.warn('ENCRYPTION_KEY 未配置，使用默认密钥（仅限开发环境）')
      this.key = scryptSync('dev-default-key', this.SALT, 32)
    } else {
      this.key = scryptSync(encryptionKey, this.SALT, 32)
    }
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
   * 脱敏显示：保留首尾各几位，中间用 * 替代
   */
  mask(value: string, headKeep = 4, tailKeep = 4): string {
    if (!value) return ''
    if (value.length <= headKeep + tailKeep) return '****'
    return `${value.slice(0, headKeep)}****${value.slice(-tailKeep)}`
  }
}
