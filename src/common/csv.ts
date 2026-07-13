/**
 * CSV 字段转义：含逗号、引号或换行时用双引号包裹，内部引号转义为两个引号。
 *
 * 公式注入防护：字段以 `= + - @ \t \r` 开头时，在前面加单引号 `'` 阻止 Excel/WPS/Sheets
 * 把字段内容当作公式执行（如 `=HYPERLINK(...)` 钓鱼、`=SUM(A1)` 篡改）。单引号在表格中
 * 不可见，不影响展示但能阻断公式解析。
 */
const CSV_FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/

export function escapeCsvField(value: unknown): string {
  let str = String(value)
  // 公式注入防护：在公式触发字符前加单引号
  if (CSV_FORMULA_PREFIX_REGEX.test(str)) {
    str = `'${str}`
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * 将对象数组序列化为 Excel 兼容的 CSV 字符串。
 *
 * 第一行为表头（按 headers 顺序），后续每行对应一条记录。
 */
export function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const headerLine = headers.map((h) => escapeCsvField(h)).join(',')
  const lines = rows.map((row) =>
    headers.map((h) => escapeCsvField(row[h])).join(','),
  )
  return [headerLine, ...lines].join('\n')
}
