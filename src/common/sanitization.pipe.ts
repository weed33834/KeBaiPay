import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common'

/**
 * HTML 实体字符 → 转义后字符串
 * 仅转义 OWASP 推荐的 5 个字符：& < > " '
 * 转义后浏览器将其作为文本展示，不会解析为 HTML 标签或属性
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  // 使用 \x27 表示单引号，避免在单引号字符串字面量中嵌入单引号导致解析问题
  '\x27': '&#x27;',
}

const HTML_ESCAPE_REGEX = /[&<>"'\x27]/g

function escapeHtml(str: string): string {
  return str.replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPE_MAP[ch])
}

const MAX_STRING_LENGTH = 10000

/**
 * 输入消毒 Pipe：对所有字符串字段做 HTML 实体转义。
 *
 * 设计取舍：用转义而非删除，避免正则删除可被 `<scr<script>ipt>` 等拼接绕过。
 * 项目为支付系统，无富文本场景，所有用户输入都不应包含可执行 HTML。
 *
 * 长度限制：转义后字符串长度可能增长（每个特殊字符最多 5 倍），上限 10000
 * 仍能覆盖正常业务字段（昵称、备注、商品名等），异常长输入直接拒绝。
 */
@Injectable()
export class SanitizationPipe implements PipeTransform<unknown> {
  transform(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.sanitizeString(value)
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.transform(item))
    }
    if (value && typeof value === 'object') {
      return this.sanitizeObject(value)
    }
    return value
  }

  private sanitizeString(value: string): string {
    // 先 trim 再转义，避免空白前缀干扰长度判断
    const trimmed = value.trim()
    const escaped = escapeHtml(trimmed)
    if (escaped.length > MAX_STRING_LENGTH) {
      throw new BadRequestException(`输入长度超过限制（最大 ${MAX_STRING_LENGTH} 字符）`)
    }
    return escaped
  }

  private sanitizeObject(obj: object): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.transform(value)
    }
    return result
  }
}
