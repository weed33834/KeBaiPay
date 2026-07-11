import { escapeCsvField, toCsv } from './csv'

describe('common/csv', () => {
  describe('escapeCsvField', () => {
    it('普通字符串原样返回', () => {
      expect(escapeCsvField('hello')).toBe('hello')
    })

    it('数字转字符串原样返回', () => {
      expect(escapeCsvField(123)).toBe('123')
    })

    it('null / undefined 转字符串', () => {
      expect(escapeCsvField(null)).toBe('null')
      expect(escapeCsvField(undefined)).toBe('undefined')
    })

    it('含逗号用双引号包裹', () => {
      expect(escapeCsvField('a,b')).toBe('"a,b"')
    })

    it('含双引号包裹并转义为两个引号', () => {
      expect(escapeCsvField('a"b')).toBe('"a""b"')
    })

    it('含换行用双引号包裹', () => {
      expect(escapeCsvField('a\nb')).toBe('"a\nb"')
    })

    it('同时含逗号、引号、换行', () => {
      expect(escapeCsvField('a,"b"\nc')).toBe('"a,""b""\nc"')
    })

    it('空字符串原样返回', () => {
      expect(escapeCsvField('')).toBe('')
    })
  })

  describe('toCsv', () => {
    it('生成表头 + 数据行', () => {
      const csv = toCsv(
        [
          { name: '张三', amount: 100 },
          { name: '李四', amount: 200 },
        ],
        ['name', 'amount'],
      )
      expect(csv).toBe('name,amount\n张三,100\n李四,200')
    })

    it('字段含特殊字符自动转义', () => {
      const csv = toCsv(
        [{ remark: '你好,世界', count: 1 }],
        ['remark', 'count'],
      )
      expect(csv).toBe('remark,count\n"你好,世界",1')
    })

    it('空数据仅返回表头行', () => {
      const csv = toCsv([], ['a', 'b'])
      expect(csv).toBe('a,b')
    })

    it('headers 顺序决定列顺序', () => {
      const csv = toCsv([{ a: 1, b: 2 }], ['b', 'a'])
      expect(csv).toBe('b,a\n2,1')
    })

    it('缺失字段输出 undefined', () => {
      const csv = toCsv([{ a: 1 }], ['a', 'b'])
      expect(csv).toBe('a,b\n1,undefined')
    })
  })
})
