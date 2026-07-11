import {
  getDateRange,
  getPreviousDate,
  formatDate,
  getTodayRange,
} from './date-helpers'

describe('common/date-helpers', () => {
  describe('getDateRange', () => {
    it('生成 UTC 闭区间', () => {
      const { start, end } = getDateRange('2026-06-01', '2026-06-30')
      expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
      expect(end.toISOString()).toBe('2026-06-30T23:59:59.999Z')
    })

    it('起止为同一天', () => {
      const { start, end } = getDateRange('2026-01-15', '2026-01-15')
      expect(start.toISOString()).toBe('2026-01-15T00:00:00.000Z')
      expect(end.toISOString()).toBe('2026-01-15T23:59:59.999Z')
    })
  })

  describe('getPreviousDate', () => {
    it('返回前一天 YYYY-MM-DD', () => {
      expect(getPreviousDate('2026-06-26')).toBe('2026-06-25')
    })

    it('跨月', () => {
      expect(getPreviousDate('2026-07-01')).toBe('2026-06-30')
    })

    it('跨年', () => {
      expect(getPreviousDate('2026-01-01')).toBe('2025-12-31')
    })

    it('闰年 2 月', () => {
      expect(getPreviousDate('2024-03-01')).toBe('2024-02-29')
    })
  })

  describe('formatDate', () => {
    it('格式化为 YYYY-MM-DD', () => {
      expect(formatDate(new Date('2026-06-26T15:30:00.000Z'))).toBe('2026-06-26')
    })

    it('午夜边界', () => {
      expect(formatDate(new Date('2026-06-26T00:00:00.000Z'))).toBe('2026-06-26')
    })
  })

  describe('getTodayRange', () => {
    it('返回今天 UTC 闭区间', () => {
      const { start, end } = getTodayRange()
      const today = new Date().toISOString().slice(0, 10)
      expect(start.toISOString()).toBe(`${today}T00:00:00.000Z`)
      expect(end.toISOString()).toBe(`${today}T23:59:59.999Z`)
    })
  })
})
