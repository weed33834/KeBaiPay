import {
  maskPhone,
  maskEmail,
  maskIdCard,
  maskBankCard,
} from './mask'

describe('common/mask', () => {
  describe('maskPhone', () => {
    it('保留前 3 后 4，中间 ****', () => {
      expect(maskPhone('13812341234')).toBe('138****1234')
    })

    it('过短返回 ****', () => {
      expect(maskPhone('1234567')).toBe('****')
    })

    it('空值返回 ****', () => {
      expect(maskPhone('')).toBe('****')
    })
  })

  describe('maskEmail', () => {
    it('保留本地部分前 2 位与域名', () => {
      expect(maskEmail('ab@example.com')).toBe('ab***@example.com')
    })

    it('长本地部分仅保留前 2 位', () => {
      expect(maskEmail('abcdef@example.com')).toBe('ab***@example.com')
    })

    it('无 @ 符号返回 ****', () => {
      expect(maskEmail('not-an-email')).toBe('****')
    })

    it('空值返回空串', () => {
      expect(maskEmail('')).toBe('')
    })
  })

  describe('maskIdCard', () => {
    it('18 位身份证保留前 3 后 4，中间逐位 *', () => {
      expect(maskIdCard('110101199001011234')).toBe('110***********1234')
    })

    it('过短返回 ****', () => {
      expect(maskIdCard('1234567')).toBe('****')
    })

    it('空值返回 ****', () => {
      expect(maskIdCard('')).toBe('****')
    })
  })

  describe('maskBankCard', () => {
    it('保留前 4 后 4，中间 ****', () => {
      expect(maskBankCard('622812341234')).toBe('6228****1234')
    })

    it('16 位卡号保留前 4 后 4', () => {
      expect(maskBankCard('6228123412345678')).toBe('6228****5678')
    })

    it('过短返回 ****', () => {
      expect(maskBankCard('12345678')).toBe('****')
    })

    it('空值返回 ****', () => {
      expect(maskBankCard('')).toBe('****')
    })
  })
})
