/**
 * 日期处理工具（统一使用 UTC，避免时区漂移）。
 */

/**
 * 根据 YYYY-MM-DD 起止日期生成 [start, end] 闭区间（UTC）。
 * start 为当天 00:00:00.000Z，end 为当天 23:59:59.999Z。
 */
export function getDateRange(
  startDate: string,
  endDate: string,
): { start: Date; end: Date } {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T23:59:59.999Z`)
  return { start, end }
}

/**
 * 返回前一天的 YYYY-MM-DD（UTC）。
 */
export function getPreviousDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * 格式化为 YYYY-MM-DD（UTC）。
 */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * 返回今天的 [start, end] 闭区间（UTC）。
 */
export function getTodayRange(): { start: Date; end: Date } {
  const today = new Date().toISOString().slice(0, 10)
  return {
    start: new Date(`${today}T00:00:00.000Z`),
    end: new Date(`${today}T23:59:59.999Z`),
  }
}
