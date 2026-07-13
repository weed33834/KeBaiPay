import { ConfigService } from '@nestjs/config'
import { CryptoService } from './crypto.service'

type ConfigServiceMock = { get: jest.Mock }

/**
 * 创建 ConfigService mock，按 env 映射返回 ENCRYPTION_KEY
 */
function createConfigService(encryptionKey: string | undefined): ConfigServiceMock {
  const env: Record<string, string | undefined> = {
    ENCRYPTION_KEY: encryptionKey,
  }
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      return key in env ? env[key] : defaultValue
    }),
  }
}

// 所有测试密钥长度 >= 32，匹配 CryptoService.onModuleInit 的校验
const VALID_KEY = 'test-encryption-key-for-unit-tests-32+'
const KEY_ALPHA = 'key-alpha-1234567890123456789012'
const KEY_BRAVO = 'key-bravo-8765432109876543210987'

describe('CryptoService', () => {
  let service: CryptoService

  beforeEach(() => {
    service = new CryptoService(
      createConfigService(VALID_KEY) as unknown as ConfigService,
    )
    // 触发密钥派生，模拟 NestJS 启动时的 onModuleInit
    service.onModuleInit()
  })

  describe('encrypt / decrypt 往返', () => {
    it('加密后解密能还原原文', () => {
      const plaintext = '6222021234567890123'

      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('不同明文产生不同密文', () => {
      const enc1 = service.encrypt('plaintext-a')
      const enc2 = service.encrypt('plaintext-b')

      expect(enc1).not.toBe(enc2)
      expect(service.decrypt(enc1)).toBe('plaintext-a')
      expect(service.decrypt(enc2)).toBe('plaintext-b')
    })

    it('相同明文加密两次产生不同密文(随机 IV)', () => {
      const plaintext = 'same-plaintext'

      const enc1 = service.encrypt(plaintext)
      const enc2 = service.encrypt(plaintext)

      expect(enc1).not.toBe(enc2)
      expect(service.decrypt(enc1)).toBe(plaintext)
      expect(service.decrypt(enc2)).toBe(plaintext)
    })

    it('密文格式正确: base64 解码后 = IV(12) + 密文 + authTag(16)', () => {
      const plaintext = 'hello-world'
      const encrypted = service.encrypt(plaintext)

      const buf = Buffer.from(encrypted, 'base64')
      const ivLength = 12
      const authTagLength = 16
      const ciphertextLength = Buffer.byteLength(plaintext, 'utf8')

      expect(buf.length).toBe(ivLength + ciphertextLength + authTagLength)
    })

    it('篡改密文后解密抛错(authTag 校验失败)', () => {
      const encrypted = service.encrypt('sensitive-data')

      const buf = Buffer.from(encrypted, 'base64')
      const tampered = Buffer.from(buf)
      tampered[12] = tampered[12] ^ 0xff

      expect(() => service.decrypt(tampered.toString('base64'))).toThrow()
    })

    it('用不同 key 解密失败', () => {
      const serviceA = new CryptoService(
        createConfigService(KEY_ALPHA) as unknown as ConfigService,
      )
      serviceA.onModuleInit()
      const serviceB = new CryptoService(
        createConfigService(KEY_BRAVO) as unknown as ConfigService,
      )
      serviceB.onModuleInit()

      const encrypted = serviceA.encrypt('cross-key-secret')

      expect(() => serviceB.decrypt(encrypted)).toThrow()
    })

    it('空字符串加密后能正确解密', () => {
      const encrypted = service.encrypt('')

      const buf = Buffer.from(encrypted, 'base64')
      expect(buf.length).toBe(28)
      expect(service.decrypt(encrypted)).toBe('')
    })

    it('Unicode/特殊字符(含 emoji)加密后能还原', () => {
      const plaintexts = [
        '中文测试敏感数据',
        '日本語テスト',
        'emoji 🎉🚀 test',
        'line1\nline2\ttab',
      ]

      for (const plaintext of plaintexts) {
        const encrypted = service.encrypt(plaintext)
        expect(service.decrypt(encrypted)).toBe(plaintext)
      }
    })
  })

  describe('mask 脱敏', () => {
    it('手机号脱敏: 保留首 4 末 4', () => {
      expect(service.mask('13800138000')).toBe('1380****8000')
    })

    it('身份证号脱敏(18 位)', () => {
      expect(service.mask('110101199001011234')).toBe('1101****1234')
    })

    it('银行卡号脱敏(19 位)', () => {
      expect(service.mask('6222021234567890123')).toBe('6222****0123')
    })

    it('空字符串返回空字符串', () => {
      expect(service.mask('')).toBe('')
    })

    it('长度不超过 head+tail 时返回 ****', () => {
      expect(service.mask('12345678')).toBe('****')
      expect(service.mask('123')).toBe('****')
    })

    it('长度恰好 head+tail+1 时正常脱敏', () => {
      expect(service.mask('123456789')).toBe('1234****6789')
    })

    it('自定义 head/tail 参数', () => {
      expect(service.mask('13800138000', 3, 4)).toBe('138****8000')
      expect(service.mask('13800138000', 3, 3)).toBe('138****000')
    })
  })

  describe('密钥校验', () => {
    it('ENCRYPTION_KEY 未配置时拒绝启动', () => {
      const devService = new CryptoService(
        createConfigService(undefined) as unknown as ConfigService,
      )
      expect(() => devService.onModuleInit()).toThrow(/ENCRYPTION_KEY/)
    })

    it('ENCRYPTION_KEY 长度不足 32 时拒绝启动', () => {
      const devService = new CryptoService(
        createConfigService('short-key') as unknown as ConfigService,
      )
      expect(() => devService.onModuleInit()).toThrow(/ENCRYPTION_KEY/)
    })
  })
})
