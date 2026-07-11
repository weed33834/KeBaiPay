import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common'

const HTML_TAG_REGEX = /<[^>]*>/g
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const EVENT_HANDLER_REGEX = /\s+on\w+\s*=\s*["'][^"']*["']/gi
const DANGEROUS_ATTR_REGEX = /javascript\s*:/gi
const MAX_STRING_LENGTH = 10000

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
    let sanitized = value.trim()

    sanitized = sanitized
      .replace(SCRIPT_REGEX, '')
      .replace(EVENT_HANDLER_REGEX, '')
      .replace(DANGEROUS_ATTR_REGEX, '')
      .replace(HTML_TAG_REGEX, '')

    if (sanitized.length > MAX_STRING_LENGTH) {
      throw new BadRequestException(`输入长度超过限制（最大 ${MAX_STRING_LENGTH} 字符）`)
    }

    return sanitized
  }

  private sanitizeObject(obj: object): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.transform(value)
    }
    return result
  }
}
