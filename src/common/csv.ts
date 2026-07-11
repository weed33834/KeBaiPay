/**
 * CSV 字段转义：含逗号、引号或换行时用双引号包裹，内部引号转义为两个引号。
 */
export function escapeCsvField(value: unknown): string {
  const str = String(value)
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
