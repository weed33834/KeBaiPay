import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * 生产环境安全校验
 *
 * 在应用启动时检查关键密钥是否仍为默认值，
 * 如果生产环境使用了默认密钥则拒绝启动。
 */
@Injectable()
export class SecurityValidatorService {
  private readonly logger = new Logger(SecurityValidatorService.name)

  // 已知的默认（不安全）密钥
  private readonly DEFAULT_SECRETS = [
    'change-user-secret-in-production',
    'change-admin-secret-in-production',
    'change-this-in-production',
    'change-encryption-key-in-production',
    'kb-user-secret-dev-2024-not-for-prod',
    'kb-admin-secret-dev-2024-not-for-prod',
    'kb-encryption-key-dev-2024',
  ]

  // 密钥最小长度要求
  private readonly MIN_SECRET_LENGTH = 32

  constructor(private readonly configService: ConfigService) {}

  /**
   * 校验所有密钥，生产环境使用默认密钥时抛出异常
   */
  validate(): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development')
    const isProduction = nodeEnv === 'production'

    const checks = [
      { name: 'JWT_USER_SECRET', value: this.configService.get<string>('JWT_USER_SECRET') },
      { name: 'JWT_ADMIN_SECRET', value: this.configService.get<string>('JWT_ADMIN_SECRET') },
      { name: 'ADMIN_DEFAULT_PASSWORD', value: this.configService.get<string>('ADMIN_DEFAULT_PASSWORD') },
      { name: 'ENCRYPTION_KEY', value: this.configService.get<string>('ENCRYPTION_KEY') },
    ]

    const warnings: string[] = []
    const errors: string[] = []

    for (const check of checks) {
      if (!check.value) {
        errors.push(`${check.name} 未配置`)
        continue
      }
      if (this.DEFAULT_SECRETS.includes(check.value)) {
        if (isProduction) {
          errors.push(`${check.name} 使用了默认值，生产环境必须修改`)
        } else {
          warnings.push(`${check.name} 使用了默认值，仅限开发环境`)
        }
      }
      // 密钥长度检查（非密码字段要求至少 32 位）
      if (check.name !== 'ADMIN_DEFAULT_PASSWORD') {
        if (check.value.length < this.MIN_SECRET_LENGTH) {
          if (isProduction) {
            errors.push(`${check.name} 长度不足 ${this.MIN_SECRET_LENGTH} 位，生产环境不安全`)
          } else {
            warnings.push(`${check.name} 长度不足 ${this.MIN_SECRET_LENGTH} 位`)
          }
        }
      } else {
        // ADMIN_DEFAULT_PASSWORD 长度检查
        const password = check.value
        if (password.length < 8) {
          if (isProduction) {
            errors.push(`${check.name} 长度不足 8 位，生产环境不安全`)
          } else {
            warnings.push(`${check.name} 长度不足 8 位`)
          }
        } else {
          // 生产环境额外校验复杂度
          if (isProduction) {
            const hasUpper = /[A-Z]/.test(password)
            const hasLower = /[a-z]/.test(password)
            const hasDigit = /\d/.test(password)
            if (!(hasUpper && hasLower && hasDigit)) {
              errors.push(`${check.name} 必须包含大写字母、小写字母和数字，生产环境不安全`)
            }
          }
        }
      }
    }

    // 输出警告
    for (const w of warnings) {
      this.logger.warn(w)
    }

    // 生产环境必须配置 Redis（分布式锁、限流、防重放依赖 Redis）
    if (isProduction) {
      const redisUrl = this.configService.get<string>('REDIS_URL')
      if (!redisUrl) {
        errors.push('生产环境必须配置 REDIS_URL（分布式锁、限流、防重放依赖 Redis）')
      }
    }

    // 生产环境 CORS_ORIGINS 必须配置，不允许回退到 localhost
    if (isProduction) {
      const corsOrigins = this.configService.get<string>('CORS_ORIGINS')
      if (!corsOrigins) {
        errors.push('生产环境必须配置 CORS_ORIGINS（不允许回退到 localhost）')
      } else {
        const origins = corsOrigins.split(',').map((o) => o.trim())
        const hasLocalhost = origins.some(
          (o) => o.includes('localhost') || o.includes('127.0.0.1'),
        )
        if (hasLocalhost) {
          this.logger.warn('CORS_ORIGINS 包含 localhost，生产环境应该只配置真实域名')
        }
      }
    }

    // 生产环境有错误则拒绝启动
    if (errors.length > 0) {
      for (const e of errors) {
        this.logger.error(e)
      }
      throw new Error(
        `生产环境安全校验失败，请修复以下问题后重启：\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      )
    }

    if (isProduction) {
      this.logger.log('生产环境安全校验通过')
    }
  }
}
