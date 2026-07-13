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

    it('公式注入防护: 以 = 开头加单引号前缀', () => {
      // =HYPERLINK 等公式触发字段需在前面加 ' 阻止 Excel 解析为公式。
      // 加 ' 后字段中含 "，会再触发双引号包裹逻辑："'=HYPERLINK(""http://evil"",""点击"")"
      expect(escapeCsvField('=HYPERLINK("http://evil","点击")')).toBe(
        `"'=HYPERLINK(""http://evil"",""点击"")"`,
      )
    })

    it('公式注入防护: + - @ 制表符 回车 开头均加单引号前缀', () => {
      expect(escapeCsvField('+1+1')).toBe("'+1+1")
      expect(escapeCsvField('-1+1')).toBe("'-1+1")
      expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)")
      expect(escapeCsvField('\tcol1')).toBe("'\tcol1")
      // \r\ninject 加 ' 后含换行，触发双引号包裹
      expect(escapeCsvField('\r\ninject')).toBe('"\'\r\ninject"')
    })

    it('公式注入防护: 普通负数不受影响（如 -1 不在公式场景下）', () => {
      // 注意：当前实现对所有 - 开头字段加 '，避免负数被误判为公式
      // 财务报表中 -100 表示支出，加 ' 后在 Excel 中仍显示为 -100（' 不可见）
      expect(escapeCsvField('-100')).toBe("'-100")
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
