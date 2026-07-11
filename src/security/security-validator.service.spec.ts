import { ConfigService } from '@nestjs/config'
import { SecurityValidatorService } from './security-validator.service'

type ConfigServiceMock = { get: jest.Mock }

/**
 * 创建 ConfigService mock，按 env 映射返回配置值
 */
function createConfigService(env: Record<string, string | undefined>): ConfigServiceMock {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      return key in env ? env[key] : defaultValue
    }),
  }
}

// 已知的默认(不安全)密钥
const DEFAULT_USER_SECRET = 'change-user-secret-in-production'
const DEFAULT_ADMIN_SECRET = 'change-admin-secret-in-production'
const DEFAULT_ENC_KEY = 'change-encryption-key-in-production'

// 自定义安全密钥(长度 >= 32)
const SAFE_USER_SECRET = 'safe-user-jwt-secret-1234567890ab'
const SAFE_ADMIN_SECRET = 'safe-admin-jwt-secret-7890123456cd'
const SAFE_ENC_KEY = 'safe-encryption-key-34567890123456'
const SAFE_ADMIN_PASSWORD = 'SafeAdmin2026Pwd'

describe('SecurityValidatorService', () => {
  let service: SecurityValidatorService

  /**
   * 构造服务实例并执行 validate，返回是否抛错
   */
  const validateAndCapture = (
    env: Record<string, string | undefined>,
  ): { threw: boolean; message: string } => {
    service = new SecurityValidatorService(
      createConfigService(env) as unknown as ConfigService,
    )
    try {
      service.validate()
      return { threw: false, message: '' }
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) }
    }
  }

  describe('生产环境校验', () => {
    const PROD_ENV: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      JWT_USER_SECRET: DEFAULT_USER_SECRET,
      JWT_ADMIN_SECRET: DEFAULT_ADMIN_SECRET,
      ADMIN_DEFAULT_PASSWORD: DEFAULT_ADMIN_SECRET,
      ENCRYPTION_KEY: DEFAULT_ENC_KEY,
      REDIS_URL: 'redis://localhost:6379',
    }

    it('使用全部默认密钥时抛错', () => {
      const result = validateAndCapture(PROD_ENV)

      expect(result.threw).toBe(true)
      expect(result.message).toContain('JWT_USER_SECRET')
      expect(result.message).toContain('使用了默认值')
    })

    it('使用自定义安全密钥 + REDIS_URL 时通过', () => {
      const result = validateAndCapture({
        ...PROD_ENV,
        JWT_USER_SECRET: SAFE_USER_SECRET,
        JWT_ADMIN_SECRET: SAFE_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: SAFE_ADMIN_PASSWORD,
        ENCRYPTION_KEY: SAFE_ENC_KEY,
      })

      expect(result.threw).toBe(false)
    })

    it('缺少 REDIS_URL 时抛错', () => {
      const { REDIS_URL: _omit, ...envWithoutRedis } = PROD_ENV
      void _omit
      const result = validateAndCapture({
        ...envWithoutRedis,
        JWT_USER_SECRET: SAFE_USER_SECRET,
        JWT_ADMIN_SECRET: SAFE_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: SAFE_ADMIN_PASSWORD,
        ENCRYPTION_KEY: SAFE_ENC_KEY,
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('REDIS_URL')
    })

    it('缺少某项密钥时抛错', () => {
      const { JWT_USER_SECRET: _omit, ...envWithoutUserSecret } = PROD_ENV
      void _omit
      const result = validateAndCapture({
        ...envWithoutUserSecret,
        JWT_ADMIN_SECRET: SAFE_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: SAFE_ADMIN_PASSWORD,
        ENCRYPTION_KEY: SAFE_ENC_KEY,
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('JWT_USER_SECRET')
      expect(result.message).toContain('未配置')
    })

    it('密钥长度不足 32 位时抛错', () => {
      const result = validateAndCapture({
        ...PROD_ENV,
        JWT_USER_SECRET: 'short', // < 32
        JWT_ADMIN_SECRET: SAFE_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: SAFE_ADMIN_PASSWORD,
        ENCRYPTION_KEY: SAFE_ENC_KEY,
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('JWT_USER_SECRET')
      expect(result.message).toContain('长度不足 32 位')
    })
  })

  describe('非生产环境(开发)校验', () => {
    const DEV_ENV: Record<string, string | undefined> = {
      NODE_ENV: 'development',
      JWT_USER_SECRET: DEFAULT_USER_SECRET,
      JWT_ADMIN_SECRET: DEFAULT_ADMIN_SECRET,
      ADMIN_DEFAULT_PASSWORD: DEFAULT_ADMIN_SECRET,
      ENCRYPTION_KEY: DEFAULT_ENC_KEY,
    }

    it('使用默认密钥时通过(仅警告不抛错)', () => {
      const result = validateAndCapture(DEV_ENV)

      expect(result.threw).toBe(false)
    })

    it('使用自定义密钥时通过', () => {
      const result = validateAndCapture({
        ...DEV_ENV,
        JWT_USER_SECRET: SAFE_USER_SECRET,
        JWT_ADMIN_SECRET: SAFE_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: SAFE_ADMIN_PASSWORD,
        ENCRYPTION_KEY: SAFE_ENC_KEY,
      })

      expect(result.threw).toBe(false)
    })

    it('缺少密钥时仍抛错(缺失检查不受环境限制)', () => {
      const { ENCRYPTION_KEY: _omit, ...envWithoutEnc } = DEV_ENV
      void _omit
      const result = validateAndCapture(envWithoutEnc)

      // 即使在开发环境，密钥未配置仍会抛错
      expect(result.threw).toBe(true)
      expect(result.message).toContain('ENCRYPTION_KEY')
      expect(result.message).toContain('未配置')
    })
  })

  describe('ADMIN_DEFAULT_PASSWORD 长度豁免', () => {
    it('ADMIN_DEFAULT_PASSWORD 长度不足 32 时不报长度错误(仅检查默认值)', () => {
      const result = validateAndCapture({
        NODE_ENV: 'production',
        JWT_USER_SECRET: SAFE_USER_SECRET,
        JWT_ADMIN_SECRET: SAFE_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: 'Short123', // < 32 但非默认值，符合复杂度
        ENCRYPTION_KEY: SAFE_ENC_KEY,
        REDIS_URL: 'redis://localhost:6379',
      })

      // ADMIN_DEFAULT_PASSWORD 不检查 32 位长度，只检查 8 位长度 + 复杂度
      expect(result.threw).toBe(false)
    })
  })

  describe('NODE_ENV 默认值', () => {
    it('NODE_ENV 未设置时按 development 处理(使用默认密钥不抛错)', () => {
      const result = validateAndCapture({
        // 不设置 NODE_ENV
        JWT_USER_SECRET: DEFAULT_USER_SECRET,
        JWT_ADMIN_SECRET: DEFAULT_ADMIN_SECRET,
        ADMIN_DEFAULT_PASSWORD: DEFAULT_ADMIN_SECRET,
        ENCRYPTION_KEY: DEFAULT_ENC_KEY,
      })

      expect(result.threw).toBe(false)
    })
  })

  describe('多错误收集', () => {
    it('多项错误同时在错误消息中列出', () => {
      const result = validateAndCapture({
        NODE_ENV: 'production',
        // 全部缺失
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('JWT_USER_SECRET')
      expect(result.message).toContain('JWT_ADMIN_SECRET')
      expect(result.message).toContain('ADMIN_DEFAULT_PASSWORD')
      expect(result.message).toContain('ENCRYPTION_KEY')
      expect(result.message).toContain('REDIS_URL')
    })
  })
})
