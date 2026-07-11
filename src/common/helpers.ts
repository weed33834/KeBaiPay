import { randomBytes } from 'crypto'
import { lookup as dnsLookup, type LookupAddress } from 'dns'
import { isIPv4, isIPv6 } from 'net'

export function yuanToFen(yuan: number): number {
  if (yuan < 0 || !Number.isFinite(yuan)) {
    throw new Error('金额必须为非负有限数字')
  }
  if (yuan > 1e9) {
    throw new Error('金额超出上限')
  }
  // toFixed(2) 返回定点小数字符串，避免 toString() 对极小/极大值
  // 产生科学计数法（如 1e-7）导致 parseInt 解析错误
  const [integer, decimal = ''] = yuan.toFixed(2).split('.')
  return parseInt(integer, 10) * 100 + parseInt(decimal, 10)
}

export function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2)
}

export function generateOrderNo(prefix: string): string {
  const now = Date.now().toString(36).toUpperCase()
  const random = randomBytes(4).toString('hex').toUpperCase()
  return `${prefix}${now}${random}`
}

export function generatePaymentNo(): string {
  const random = randomBytes(4).toString('hex').toUpperCase()
  return `P${Date.now()}${random}`
}

export function generateQrCode(): string {
  const now = Date.now().toString(36).toUpperCase()
  const random = randomBytes(4).toString('hex').toUpperCase()
  return `KB-${now}${random}`
}

export function generateMerchantNo(): string {
  const random = randomBytes(4).toString('hex').toUpperCase()
  return `M${Date.now()}${random}`
}

export function generateAppId(): string {
  return `app_${randomBytes(8).toString('hex')}`
}

export function generateAppSecret(): string {
  return randomBytes(16).toString('hex')
}

/**
 * 校验回调 URL 是否安全（防 SSRF，含 DNS rebinding 防护）
 *
 * 拦截：非 http/https 协议、hostname 为内网字面量、以及 DNS 解析出的
 * 任一 A/AAAA 记录命中内网/保留/回环段。
 *
 * 异步：需调用 dns.lookup 解析 hostname 的全部 IP 后逐条判断，
 * 避免 attacker.com 先解析公网 IP 通过校验、再 rebinding 到内网。
 */
export async function isCallbackUrlSafe(
  url: string,
): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { safe: false, reason: 'CALLBACK_URL_FORMAT_INVALID' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { safe: false, reason: 'CALLBACK_URL_PROTOCOL_INVALID' }
  }
  const hostname = parsed.hostname

  // 直接拦截明显的内网/回环字面量
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1') {
    return { safe: false, reason: 'CALLBACK_URL_INTERNAL' }
  }
  // 拦截十进制/八进制/十六进制 IP 字面量
  if (/^\d+$/.test(hostname) || hostname.startsWith('0x') || /^0\d+\./.test(hostname)) {
    return { safe: false, reason: 'CALLBACK_URL_INTERNAL' }
  }

  // DNS 解析所有 A/AAAA 记录，逐条判断是否为内网/保留/回环地址
  let addresses: LookupAddress[]
  try {
    addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      dnsLookup(hostname, { all: true }, (err, addrs) => {
        if (err) reject(err)
        else resolve(addrs ?? [])
      })
    })
  } catch {
    return { safe: false, reason: 'CALLBACK_URL_FORMAT_INVALID' }
  }
  if (addresses.length === 0) {
    return { safe: false, reason: 'CALLBACK_URL_FORMAT_INVALID' }
  }
  for (const addr of addresses) {
    if (isInternalIp(addr.address)) {
      return { safe: false, reason: 'CALLBACK_URL_INTERNAL' }
    }
  }
  return { safe: true }
}

/**
 * 判断 IP 是否为内网/保留/回环地址
 * 仅识别 IPv4 与 IPv6，未知格式按不安全处理。
 */
function isInternalIp(ip: string): boolean {
  if (isIPv4(ip)) return isInternalIPv4(ip)
  if (isIPv6(ip)) return isInternalIPv6(ip)
  return true
}

function isInternalIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  return false
}

function isInternalIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // ::1 回环（含完整展开形式）
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
  // IPv4-mapped IPv6：::ffff:a.b.c.d 或 ::ffff:xxxx:xxxx，按内嵌 IPv4 判断
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice('::ffff:'.length)
    if (rest.includes('.')) {
      if (isInternalIPv4(rest)) return true
    } else {
      const groups = rest.split(':')
      if (groups.length === 2) {
        const hi = parseInt(groups[0], 16)
        const lo = parseInt(groups[1], 16)
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
          if (isInternalIPv4(ipv4)) return true
        }
      }
    }
  }
  // 取首个 hextet 判断 ULA / link-local
  const first = firstHextet(lower)
  if (first !== null) {
    if (first >= 0xfc00 && first <= 0xfdff) return true // fc00::/7（唯一本地地址）
    if (first >= 0xfe80 && first <= 0xfebf) return true // fe80::/10（链路本地）
  }
  return false
}

// 取 IPv6 地址的首个 hextet 数值；以 '::' 开头表示前导零压缩，首 hextet 视为 0
function firstHextet(ip: string): number | null {
  if (ip.startsWith('::')) return 0
  const head = ip.split(':')[0]
  if (head === '' || head.includes('.')) return null
  const n = parseInt(head, 16)
  return Number.isNaN(n) ? null : n
}
