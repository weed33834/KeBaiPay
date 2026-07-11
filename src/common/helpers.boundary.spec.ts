import {
  yuanToFen,
  fenToYuan,
  generateAppId,
  generateAppSecret,
} from './helpers'

describe('common/helpers 边界值测试', () => {
  describe('yuanToFen 边界值', () => {
    it('0 元 → 0 分（最小非负值）', () => {
      expect(yuanToFen(0)).toBe(0)
    })

    it('0.01 元 → 1 分（最小交易单位）', () => {
      expect(yuanToFen(0.01)).toBe(1)
    })

    it('99.99 元 → 9999 分（两位小数最大值）', () => {
      expect(yuanToFen(99.99)).toBe(9999)
    })

    it('1000000 元（百万）→ 100000000 分', () => {
      expect(yuanToFen(1000000)).toBe(100000000)
    })

    it('负数抛出异常', () => {
      expect(() => yuanToFen(-0.01)).toThrow('金额必须为非负有限数字')
      expect(() => yuanToFen(-1)).toThrow('金额必须为非负有限数字')
      expect(() => yuanToFen(-1000000)).toThrow('金额必须为非负有限数字')
    })

    it('NaN 抛出异常', () => {
      expect(() => yuanToFen(NaN)).toThrow('金额必须为非负有限数字')
    })

    it('Infinity 抛出异常', () => {
      expect(() => yuanToFen(Infinity)).toThrow('金额必须为非负有限数字')
      expect(() => yuanToFen(-Infinity)).toThrow('金额必须为非负有限数字')
    })

    it('浮点精度：0.1 + 0.2 = 0.30000000000000004 转为 30 分而非 31 分', () => {
      // 经典 IEEE 754 浮点精度问题：0.1 + 0.2 不精确等于 0.3
      expect(0.1 + 0.2).not.toBe(0.3)
      expect(0.1 + 0.2).toBe(0.30000000000000004)
      // yuanToFen 通过 toFixed(2) 规避精度问题，应得到 30 分
      expect(yuanToFen(0.1 + 0.2)).toBe(30)
      expect(yuanToFen(0.3)).toBe(30)
    })

    it('其他浮点精度边界值', () => {
      expect(yuanToFen(0.1)).toBe(10)
      expect(yuanToFen(0.2)).toBe(20)
      expect(yuanToFen(19.99)).toBe(1999)
      expect(yuanToFen(99.95)).toBe(9995)
      expect(yuanToFen(123.45)).toBe(12345)
    })

    it('上限边界：1e9 元（10 亿元）→ 1e11 分（允许，恰好等于上限）', () => {
      // 实现检查 yuan > 1e9 才抛错，1e9 本身允许
      expect(yuanToFen(1e9)).toBe(100000000000)
      expect(yuanToFen(1000000000)).toBe(100000000000)
    })

    it('超过上限：1e9 + 0.01 元抛出 "金额超出上限"', () => {
      expect(() => yuanToFen(1000000000.01)).toThrow('金额超出上限')
      expect(() => yuanToFen(1e9 + 1)).toThrow('金额超出上限')
    })

    it('超大金额 Number.MAX_SAFE_INTEGER / 100 因超出业务上限被拦截', () => {
      // 算术安全边界 ≈ 9.007e13，远超业务上限 1e9
      const safeBoundary = Number.MAX_SAFE_INTEGER / 100
      expect(safeBoundary).toBeGreaterThan(1e9)
      // 超出业务上限，应抛 '金额超出上限' 而非精度错误
      expect(() => yuanToFen(safeBoundary)).toThrow('金额超出上限')
      expect(() => yuanToFen(Number.MAX_SAFE_INTEGER)).toThrow('金额超出上限')
    })
  })

  describe('fenToYuan 边界值', () => {
    it('0 分 → "0.00" 元', () => {
      expect(fenToYuan(0)).toBe('0.00')
    })

    it('1 分 → "0.01" 元（最小单位）', () => {
      expect(fenToYuan(1)).toBe('0.01')
    })

    it('9999 分 → "99.99" 元', () => {
      expect(fenToYuan(9999)).toBe('99.99')
    })

    it('100 分 → "1.00" 元', () => {
      expect(fenToYuan(100)).toBe('1.00')
    })

    it('负数分：实现不校验负数，直接计算返回负数字符串', () => {
      // fenToYuan 实现仅做 (fen / 100).toFixed(2)，不检查负数
      expect(fenToYuan(-100)).toBe('-1.00')
      expect(fenToYuan(-1)).toBe('-0.01')
    })

    it('yuanToFen / fenToYuan 互逆：边界值回环', () => {
      expect(fenToYuan(yuanToFen(0))).toBe('0.00')
      expect(fenToYuan(yuanToFen(0.01))).toBe('0.01')
      expect(fenToYuan(yuanToFen(99.99))).toBe('99.99')
      expect(fenToYuan(yuanToFen(1000000))).toBe('1000000.00')
    })
  })

  describe('generateAppId 边界与唯一性', () => {
    it('格式正确：app_ 前缀 + 16 位 hex', () => {
      expect(generateAppId()).toMatch(/^app_[0-9a-f]{16}$/)
    })

    it('长度为 20（"app_" 4 字符 + 16 hex）', () => {
      expect(generateAppId()).toHaveLength(20)
    })

    it('字符集仅含 app_ 前缀和小写 hex', () => {
      const appId = generateAppId()
      expect(appId.startsWith('app_')).toBe(true)
      expect(appId.slice(4)).toMatch(/^[0-9a-f]+$/)
    })

    it('多次调用生成不同值（唯一性）', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateAppId())
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('generateAppSecret 边界与唯一性', () => {
    it('格式正确：32 位 hex', () => {
      expect(generateAppSecret()).toMatch(/^[0-9a-f]{32}$/)
    })

    it('长度为 32', () => {
      expect(generateAppSecret()).toHaveLength(32)
    })

    it('字符集仅含小写 hex', () => {
      expect(generateAppSecret()).toMatch(/^[0-9a-f]+$/)
    })

    it('多次调用生成不同值（唯一性）', () => {
      const secrets = new Set<string>()
      for (let i = 0; i < 100; i++) {
        secrets.add(generateAppSecret())
      }
      expect(secrets.size).toBe(100)
    })
  })
})
