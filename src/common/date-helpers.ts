/**
 * 日期处理工具（统一使用 UTC，避免时区漂移）。
 * 基于 dayjs utc 插件，避免手写 Date 拼接的边界错误。
 */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

/**
 * 根据 YYYY-MM-DD 起止日期生成 [start, end] 闭区间（UTC）。
 * start 为当天 00:00:00.000Z，end 为当天 23:59:59.999Z。
 */
export function getDateRange(
  startDate: string,
  endDate: string,
): { start: Date; end: Date } {
  const start = dayjs.utc(startDate).startOf('day').toDate()
  const end = dayjs.utc(endDate).endOf('day').toDate()
  return { start, end }
}

/**
 * 返回前一天的 YYYY-MM-DD（UTC）。
 */
export function getPreviousDate(date: string): string {
  return dayjs.utc(date).subtract(1, 'day').format('YYYY-MM-DD')
}

/**
 * 格式化为 YYYY-MM-DD（UTC）。
 */
export function formatDate(date: Date): string {
  return dayjs.utc(date).format('YYYY-MM-DD')
}

/**
 * 返回今天的 [start, end] 闭区间（UTC）。
 */
export function getTodayRange(): { start: Date; end: Date } {
  const today = dayjs.utc()
  return {
    start: today.startOf('day').toDate(),
    end: today.endOf('day').toDate(),
  }
}
