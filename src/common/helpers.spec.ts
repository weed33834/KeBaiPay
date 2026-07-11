import {
  yuanToFen,
  fenToYuan,
  generateOrderNo,
  generateQrCode,
  generateMerchantNo,
  generateAppId,
  generateAppSecret,
  isCallbackUrlSafe,
} from './helpers'

// 仅 mock dns.lookup，保留 net 真实校验函数
jest.mock('dns', () => ({
  __esModule: true,
  lookup: jest.fn(),
}))
import * as dns from 'dns'

describe('common/helpers', () => {
  describe('yuanToFen', () => {
    it('把元转成分（整数）', () => {
      expect(yuanToFen(1)).toBe(100)
      expect(yuanToFen(0.01)).toBe(1)
      expect(yuanToFen(100)).toBe(10000)
    })

    it('处理浮点精度问题', () => {
      expect(yuanToFen(0.1 + 0.2)).toBe(30)
      expect(yuanToFen(19.99)).toBe(1999)
    })

    it('零值', () => {
      expect(yuanToFen(0)).toBe(0)
    })

    it('负数抛出异常', () => {
      expect(() => yuanToFen(-1.5)).toThrow('金额必须为非负有限数字')
    })
  })

  describe('fenToYuan', () => {
    it('把分转成元（两位小数字符串）', () => {
      expect(fenToYuan(100)).toBe('1.00')
      expect(fenToYuan(1)).toBe('0.01')
      expect(fenToYuan(1999)).toBe('19.99')
    })

    it('yuanToFen 和 fenToYuan 互逆', () => {
      expect(fenToYuan(yuanToFen(123.45))).toBe('123.45')
    })
  })

  describe('generateOrderNo', () => {
    it('带前缀且唯一', () => {
      const a = generateOrderNo('T')
      const b = generateOrderNo('T')
      expect(a).toMatch(/^T/)
      expect(b).toMatch(/^T/)
      expect(a).not.toBe(b)
    })
  })

  describe('generateQrCode', () => {
    it('以 KB- 开头', () => {
      expect(generateQrCode()).toMatch(/^KB-/)
    })
  })

  describe('generateMerchantNo', () => {
    it('以 M 开头', () => {
      expect(generateMerchantNo()).toMatch(/^M[0-9A-F]+$/)
    })
  })

  describe('generateAppId / generateAppSecret', () => {
    it('appId 以 app_ 开头且为 hex', () => {
      expect(generateAppId()).toMatch(/^app_[0-9a-f]{16}$/)
    })

    it('appSecret 为 32 位 hex', () => {
      expect(generateAppSecret()).toMatch(/^[0-9a-f]{32}$/)
    })

    it('每次生成都不同', () => {
      expect(generateAppSecret()).not.toBe(generateAppSecret())
    })
  })

  describe('isCallbackUrlSafe', () => {
    const lookup = dns.lookup as unknown as jest.Mock

    beforeEach(() => {
      lookup.mockReset()
    })

    function mockResolve(addrs: Array<{ address: string; family: number }>) {
      lookup.mockImplementation(
        (_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) =>
          cb(null, addrs),
      )
    }

    it('非 http/https 协议拒绝', async () => {
      const r = await isCallbackUrlSafe('ftp://example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_PROTOCOL_INVALID')
    })

    it('格式无效拒绝', async () => {
      const r = await isCallbackUrlSafe('::::not-a-url')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_FORMAT_INVALID')
    })

    it('localhost 字面量拒绝', async () => {
      const r = await isCallbackUrlSafe('https://localhost/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('0.0.0.0 字面量拒绝', async () => {
      const r = await isCallbackUrlSafe('https://0.0.0.0/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('DNS 解析失败拒绝', async () => {
      lookup.mockImplementation(
        (_h: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) =>
          cb(new Error('ENOTFOUND')),
      )
      const r = await isCallbackUrlSafe('https://no-such-host.invalid/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_FORMAT_INVALID')
    })

    it('解析到 127.0.0.1 拒绝（DNS rebinding 场景）', async () => {
      mockResolve([{ address: '127.0.0.1', family: 4 }])
      const r = await isCallbackUrlSafe('https://rebind.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 10.x 拒绝', async () => {
      mockResolve([{ address: '10.1.2.3', family: 4 }])
      const r = await isCallbackUrlSafe('https://x.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 172.16-31 拒绝', async () => {
      mockResolve([{ address: '172.16.0.1', family: 4 }])
      const r = await isCallbackUrlSafe('https://x.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 172.32 放行（不在 172.16/12 段）', async () => {
      mockResolve([{ address: '172.32.0.1', family: 4 }])
      const r = await isCallbackUrlSafe('https://x.example.com/cb')
      expect(r.safe).toBe(true)
    })

    it('解析到 192.168 拒绝', async () => {
      mockResolve([{ address: '192.168.1.1', family: 4 }])
      const r = await isCallbackUrlSafe('https://x.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 169.254 拒绝（含云元数据）', async () => {
      mockResolve([{ address: '169.254.169.254', family: 4 }])
      const r = await isCallbackUrlSafe('https://x.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 0.x 拒绝', async () => {
      mockResolve([{ address: '0.1.2.3', family: 4 }])
      const r = await isCallbackUrlSafe('https://x.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 IPv6 ::1 拒绝', async () => {
      mockResolve([{ address: '::1', family: 6 }])
      const r = await isCallbackUrlSafe('https://v6.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 fc00:: 拒绝', async () => {
      mockResolve([{ address: 'fc00::1', family: 6 }])
      const r = await isCallbackUrlSafe('https://v6.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 fe80:: 拒绝', async () => {
      mockResolve([{ address: 'fe80::1', family: 6 }])
      const r = await isCallbackUrlSafe('https://v6.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到 ::ffff:127.0.0.1 拒绝（IPv4-mapped）', async () => {
      mockResolve([{ address: '::ffff:127.0.0.1', family: 6 }])
      const r = await isCallbackUrlSafe('https://v6.example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('任一解析结果为内网即拒绝', async () => {
      mockResolve([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ])
      const r = await isCallbackUrlSafe('https://example.com/cb')
      expect(r.safe).toBe(false)
      expect(r.reason).toBe('CALLBACK_URL_INTERNAL')
    })

    it('解析到公网 IP 通过', async () => {
      mockResolve([{ address: '8.8.8.8', family: 4 }])
      const r = await isCallbackUrlSafe('https://example.com/cb')
      expect(r.safe).toBe(true)
    })
  })
})
