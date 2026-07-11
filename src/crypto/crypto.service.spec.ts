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

describe('CryptoService', () => {
  let service: CryptoService

  beforeEach(() => {
    // 使用固定的自定义密钥，避免依赖默认密钥的副作用
    service = new CryptoService(
      createConfigService('test-encryption-key-for-unit-tests') as unknown as ConfigService,
    )
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
      // 确保解密各自还原
      expect(service.decrypt(enc1)).toBe('plaintext-a')
      expect(service.decrypt(enc2)).toBe('plaintext-b')
    })

    it('相同明文加密两次产生不同密文(随机 IV)', () => {
      const plaintext = 'same-plaintext'

      const enc1 = service.encrypt(plaintext)
      const enc2 = service.encrypt(plaintext)

      // 随机 IV 保证密文不同
      expect(enc1).not.toBe(enc2)
      // 但都能解密回原文
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
      // 翻转密文区域第一个字节(IV 之后)
      tampered[12] = tampered[12] ^ 0xff

      expect(() => service.decrypt(tampered.toString('base64'))).toThrow()
    })

    it('用不同 key 解密失败', () => {
      const serviceA = new CryptoService(
        createConfigService('key-alpha-12345678') as unknown as ConfigService,
      )
      const serviceB = new CryptoService(
        createConfigService('key-bravo-87654321') as unknown as ConfigService,
      )

      const encrypted = serviceA.encrypt('cross-key-secret')

      expect(() => serviceB.decrypt(encrypted)).toThrow()
    })

    it('空字符串加密后能正确解密', () => {
      const encrypted = service.encrypt('')

      const buf = Buffer.from(encrypted, 'base64')
      // IV(12) + 空密文(0) + authTag(16) = 28 字节
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

    it('邮箱脱敏: 保留首 4 末 4', () => {
      expect(service.mask('user@example.com')).toBe('user****.com')
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
      // 默认 head=4, tail=4, 长度 <= 8
      expect(service.mask('12345678')).toBe('****')
      expect(service.mask('123')).toBe('****')
    })

    it('长度恰好 head+tail+1 时正常脱敏', () => {
      // 9 位: 首末各 4 位 + 中间 1 位被遮盖
      expect(service.mask('123456789')).toBe('1234****6789')
    })

    it('自定义 head/tail 参数', () => {
      expect(service.mask('13800138000', 3, 4)).toBe('138****8000')
      expect(service.mask('13800138000', 3, 3)).toBe('138****000')
    })
  })

  describe('默认密钥降级', () => {
    it('ENCRYPTION_KEY 未配置时使用默认密钥仍可加解密', () => {
      const devService = new CryptoService(
        createConfigService(undefined) as unknown as ConfigService,
      )

      const encrypted = devService.encrypt('dev-data')
      expect(devService.decrypt(encrypted)).toBe('dev-data')
    })
  })
})
