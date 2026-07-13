import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RiskLevel, RiskEventType, TransactionType } from '../common/enums'
import { DEFAULT_TRANSFER_DAILY_LIMIT_CENTS } from '../common/constants'

/**
 * 风控规则引擎
 *
 * 支持配置化的风控规则，在交易前执行检查。
 * 规则存储在 SystemConfig 表中，key 格式：risk_rule:{ruleCode}
 *
 * 内置规则：
 * - single_amount: 单笔金额限额
 * - daily_count: 单日交易次数限额
 * - daily_amount: 单日交易金额限额
 * - frequency: 高频交易检测（时间窗口内次数）
 * - ip_blacklist: IP 黑名单（从 SystemConfig key=risk_rule:ip_blacklist 读取，value 为 JSON 数组）
 * - ip_frequency: 同一 IP 时间窗口内访问频次限制
 */

export interface RiskRule {
  code: string
  name: string
  enabled: boolean
  // 规则参数
  params: {
    maxAmount?: number // 最大金额（分）
    maxDailyCount?: number // 每日最大次数
    maxDailyAmount?: number // 每日最大金额（分）
    windowSeconds?: number // 时间窗口（秒）
    windowMaxCount?: number // 窗口内最大次数
  }
  // 触发后的动作
  action: 'BLOCK' | 'WARN' | 'REVIEW'
}

export interface RiskCheckContext {
  userId: string
  type: 'TRANSFER' | 'WITHDRAW' | 'RECHARGE' | 'PAYMENT' | 'REFUND' | 'RED_PACKET'
  amount: number // 分
  ip?: string
  userAgent?: string
}

export interface RiskCheckResult {
  passed: boolean
  blocked: boolean
  // REVIEW 动作触发时为 true：不拦截交易但记录待审核事件
  needsReview: boolean
  warnings: string[]
  rules: { code: string; name: string; action: string; message: string }[]
}

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name)
  private readonly ruleCache = new Map<string, RiskRule>()
  private cacheLoaded = false
  private cacheExpiry = 0
  private readonly CACHE_TTL_MS = 60_000

  private ipBlacklistCache: string[] = []
  private ipBlacklistExpiry = 0
  private readonly IP_BLACKLIST_TTL_MS = 60_000

  // 默认规则
  private readonly DEFAULT_RULES: RiskRule[] = [
    {
      code: 'single_amount',
      name: '单笔金额限额',
      enabled: true,
      params: { maxAmount: DEFAULT_TRANSFER_DAILY_LIMIT_CENTS }, // 5 万元
      action: 'BLOCK',
    },
    {
      code: 'daily_count',
      name: '单日交易次数',
      enabled: true,
      params: { maxDailyCount: 50 },
      action: 'BLOCK',
    },
    {
      code: 'daily_amount',
      name: '单日交易金额',
      enabled: true,
      params: { maxDailyAmount: 200000 * 100 }, // 20 万元
      action: 'BLOCK',
    },
    {
      code: 'frequency',
      name: '高频交易检测',
      enabled: true,
      params: { windowSeconds: 60, windowMaxCount: 10 },
      action: 'WARN',
    },
    {
      code: 'ip_blacklist',
      name: 'IP 黑名单',
      enabled: true,
      params: {},
      action: 'BLOCK',
    },
    {
      code: 'ip_frequency',
      name: 'IP 高频访问',
      enabled: true,
      params: { windowSeconds: 60, windowMaxCount: 20 },
      action: 'BLOCK',
    },
  ]

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 加载全部规则（含已禁用），合并默认规则与 SystemConfig 自定义配置。
   *
   * 使用 TTL 缓存避免每次交易都查询数据库。
   */
  private async loadAllRules(): Promise<RiskRule[]> {
    if (this.cacheLoaded && Date.now() < this.cacheExpiry) {
      return Array.from(this.ruleCache.values())
    }

    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'risk_rule:' } },
    })

    const ruleMap = new Map<string, RiskRule>()
    for (const rule of this.DEFAULT_RULES) {
      ruleMap.set(rule.code, { ...rule })
    }

    for (const config of configs) {
      const code = config.key.replace('risk_rule:', '')
      try {
        const custom = JSON.parse(config.value)
        // ip_blacklist 等数组型配置存储的是数据而非规则覆盖，跳过
        if (Array.isArray(custom)) {
          continue
        }
        const existing = ruleMap.get(code)
        if (existing) {
          ruleMap.set(code, { ...existing, ...custom, params: { ...existing.params, ...custom.params } })
        } else {
          ruleMap.set(code, custom)
        }
      } catch {
        this.logger.warn(`风控规则 ${code} 配置解析失败`)
      }
    }

    this.ruleCache.clear()
    for (const [code, rule] of ruleMap) {
      this.ruleCache.set(code, rule)
    }
    this.cacheLoaded = true
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS

    return Array.from(ruleMap.values())
  }

  /**
   * 从数据库加载已启用的规则配置（未配置则使用默认值）。
   */
  private async loadRules(): Promise<RiskRule[]> {
    const all = await this.loadAllRules()
    return all.filter((r) => r.enabled)
  }

  /**
   * 获取全部风控规则列表（默认规则与 SystemConfig 自定义规则合并，含已禁用）。
   * 供管理端展示使用。
   */
  async listAllRules(): Promise<RiskRule[]> {
    return this.loadAllRules()
  }

  /**
   * 清除规则缓存（规则更新后由管理端调用）
   */
  clearCache(): void {
    this.cacheLoaded = false
    this.ruleCache.clear()
    this.ipBlacklistCache = []
    this.ipBlacklistExpiry = 0
  }

  /**
   * 执行风控检查
   */
  async check(ctx: RiskCheckContext): Promise<RiskCheckResult> {
    const rules = await this.loadRules()
    const result: RiskCheckResult = {
      passed: true,
      blocked: false,
      needsReview: false,
      warnings: [],
      rules: [],
    }

    for (const rule of rules) {
      const checkResult = await this.applyRule(rule, ctx)
      if (checkResult) {
        result.rules.push(checkResult)
        if (checkResult.action === 'BLOCK') {
          result.blocked = true
          result.passed = false
        } else if (checkResult.action === 'WARN') {
          result.warnings.push(checkResult.message)
        } else if (checkResult.action === 'REVIEW') {
          result.needsReview = true
        }
      }
    }

    // 如果被拦截，记录风险事件
    if (result.blocked) {
      await this.prisma.riskEvent.create({
        data: {
          userId: ctx.userId,
          type: this.mapBlockEventType(ctx, result.rules),
          level: RiskLevel.HIGH,
          description: `风控拦截：${result.rules
            .filter((r) => r.action === 'BLOCK')
            .map((r) => r.name)
            .join('、')}`,
        },
      })
    }

    // REVIEW：不拦截交易，但记录待审核事件
    if (result.needsReview) {
      await this.prisma.riskEvent.create({
        data: {
          userId: ctx.userId,
          type: this.mapEventTypeByCtx(ctx.type),
          level: RiskLevel.HIGH,
          description: `风控待审核：${result.rules
            .filter((r) => r.action === 'REVIEW')
            .map((r) => r.name)
            .join('、')}`,
        },
      })
    }

    return result
  }

  /**
   * 根据 ctx.type 映射风控事件类型
   */
  private mapEventTypeByCtx(type: RiskCheckContext['type']): RiskEventType {
    switch (type) {
      case 'TRANSFER':
        return RiskEventType.LARGE_TRANSFER
      case 'WITHDRAW':
        return RiskEventType.LARGE_WITHDRAWAL
      case 'PAYMENT':
        return RiskEventType.LARGE_PAYMENT
      case 'RED_PACKET':
        return RiskEventType.SUSPICIOUS_RED_PACKET
      default:
        return RiskEventType.LARGE_TRANSFER
    }
  }

  /**
   * 拦截时根据触发规则与 ctx.type 动态映射事件类型。
   * 频率规则（frequency / ip_frequency）触发 → FREQUENT_TRANSACTION，
   * 否则按 ctx.type 映射。
   */
  private mapBlockEventType(
    ctx: RiskCheckContext,
    triggeredRules: { code: string }[],
  ): RiskEventType {
    const freqCodes = ['frequency', 'ip_frequency']
    if (triggeredRules.some((r) => freqCodes.includes(r.code))) {
      return RiskEventType.FREQUENT_TRANSACTION
    }
    return this.mapEventTypeByCtx(ctx.type)
  }

  private async applyRule(
    rule: RiskRule,
    ctx: RiskCheckContext,
  ): Promise<{ code: string; name: string; action: string; message: string } | null> {
    switch (rule.code) {
      case 'single_amount': {
        if (rule.params.maxAmount && ctx.amount > rule.params.maxAmount) {
          return {
            code: rule.code,
            name: rule.name,
            action: rule.action,
            message: `单笔金额 ${ctx.amount} 超过限额 ${rule.params.maxAmount}`,
          }
        }
        break
      }
      case 'daily_count': {
        const count = await this.getDailyCount(ctx.userId, ctx.type as TransactionType)
        if (rule.params.maxDailyCount && count >= rule.params.maxDailyCount) {
          return {
            code: rule.code,
            name: rule.name,
            action: rule.action,
            message: `今日交易次数 ${count} 达到上限 ${rule.params.maxDailyCount}`,
          }
        }
        break
      }
      case 'daily_amount': {
        const total = await this.getDailyAmount(ctx.userId, ctx.type as TransactionType)
        if (
          rule.params.maxDailyAmount &&
          total + ctx.amount > rule.params.maxDailyAmount
        ) {
          return {
            code: rule.code,
            name: rule.name,
            action: rule.action,
            message: `今日交易金额 ${total + ctx.amount} 超过限额 ${rule.params.maxDailyAmount}`,
          }
        }
        break
      }
      case 'frequency': {
        const freqCount = await this.getWindowCount(
          ctx.userId,
          ctx.type as TransactionType,
          rule.params.windowSeconds || 60,
        )
        if (
          rule.params.windowMaxCount &&
          freqCount >= rule.params.windowMaxCount
        ) {
          return {
            code: rule.code,
            name: rule.name,
            action: rule.action,
            message: `${rule.params.windowSeconds} 秒内交易 ${freqCount} 次，超过阈值 ${rule.params.windowMaxCount}`,
          }
        }
        break
      }
      case 'ip_blacklist': {
        if (ctx.ip) {
          const blacklist = await this.loadIpBlacklist()
          if (blacklist.includes(ctx.ip)) {
            return {
              code: rule.code,
              name: rule.name,
              action: rule.action,
              message: `IP ${ctx.ip} 命中黑名单`,
            }
          }
        }
        break
      }
      case 'ip_frequency': {
        if (ctx.ip) {
          const ipCount = await this.getIpWindowCount(
            ctx.ip,
            rule.params.windowSeconds || 60,
          )
          if (
            rule.params.windowMaxCount &&
            ipCount >= rule.params.windowMaxCount
          ) {
            return {
              code: rule.code,
              name: rule.name,
              action: rule.action,
              message: `IP ${ctx.ip} 在 ${rule.params.windowSeconds} 秒内访问 ${ipCount} 次，超过阈值 ${rule.params.windowMaxCount}`,
            }
          }
        }
        break
      }
    }
    return null
  }

  /**
   * 从 SystemConfig（key=risk_rule:ip_blacklist）加载 IP 黑名单。
   * value 为 JSON 字符串数组。
   */
  private async loadIpBlacklist(): Promise<string[]> {
    if (Date.now() < this.ipBlacklistExpiry && this.ipBlacklistCache.length > 0) {
      return this.ipBlacklistCache
    }
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'risk_rule:ip_blacklist' },
    })
    if (!config) {
      this.ipBlacklistCache = []
      this.ipBlacklistExpiry = Date.now() + this.IP_BLACKLIST_TTL_MS
      return []
    }
    try {
      const parsed = JSON.parse(config.value)
      this.ipBlacklistCache = Array.isArray(parsed) ? parsed : []
      this.ipBlacklistExpiry = Date.now() + this.IP_BLACKLIST_TTL_MS
      return this.ipBlacklistCache
    } catch {
      this.logger.warn('ip_blacklist 配置解析失败')
      this.ipBlacklistCache = []
      this.ipBlacklistExpiry = Date.now() + this.IP_BLACKLIST_TTL_MS
      return []
    }
  }

  /**
   * 获取指定 IP 在时间窗口内的访问次数（基于 Redis 分桶计数，仅读取）。
   * Redis 不可用时返回 0。
   */
  private async getIpWindowCount(
    ip: string,
    windowSeconds: number,
  ): Promise<number> {
    if (!this.redis.isEnabled()) return 0
    // 分桶 key：按 windowSeconds 切分时间窗口，每个窗口独立计数
    // key 格式 risk:ipfreq:{ip}:{ruleWindow}:{bucket}
    const bucket = Math.floor(Date.now() / 1000 / windowSeconds)
    const key = `risk:ipfreq:${ip}:${windowSeconds}:${bucket}`
    const count = await this.redis.get(key)
    return count ? parseInt(count, 10) : 0
  }

  private async getDailyCount(userId: string, type: TransactionType): Promise<number> {
    const today = new Date().toISOString().slice(0, 10)
    const startDate = new Date(`${today}T00:00:00.000Z`)

    const count = await this.prisma.transactionOrder.count({
      where: {
        OR: [{ fromUserId: userId }, { toUserId: userId }],
        type: type,
        createdAt: { gte: startDate },
        status: 'SUCCESS',
      },
    })
    return count
  }

  private async getDailyAmount(userId: string, type: TransactionType): Promise<number> {
    const today = new Date().toISOString().slice(0, 10)
    const startDate = new Date(`${today}T00:00:00.000Z`)

    const result = await this.prisma.transactionOrder.aggregate({
      where: {
        OR: [{ fromUserId: userId }, { toUserId: userId }],
        type: type,
        createdAt: { gte: startDate },
        status: 'SUCCESS',
      },
      _sum: { amount: true },
    })
    return result._sum.amount || 0
  }

  private async getWindowCount(
    userId: string,
    type: TransactionType,
    windowSeconds: number,
  ): Promise<number> {
    if (this.redis.isEnabled()) {
      // 分桶 key：按 windowSeconds 切分时间窗口，与 recordTransaction 写入的 key 对齐
      const bucket = Math.floor(Date.now() / 1000 / windowSeconds)
      const key = `risk:freq:${userId}:${type}:${windowSeconds}:${bucket}`
      const count = await this.redis.get(key)
      return count ? parseInt(count, 10) : 0
    }
    // Redis 不可用时查询数据库
    const since = new Date(Date.now() - windowSeconds * 1000)
    const count = await this.prisma.transactionOrder.count({
      where: {
        OR: [{ fromUserId: userId }, { toUserId: userId }],
        type: type,
        createdAt: { gte: since },
        status: 'SUCCESS',
      },
    })
    return count
  }

  /**
   * 交易成功后记录频率（仅在成功后 incr，避免失败交易误计）
   * 按所有启用的 frequency / ip_frequency 规则的 windowSeconds 分别 incr 分桶 key，
   * TTL 设为 windowSeconds * 2，保证当前窗口和上一个窗口都在 Redis 中。
   */
  async recordTransaction(ctx: RiskCheckContext): Promise<void> {
    if (!this.redis.isEnabled()) return

    // 收集所有启用的频率规则的 windowSeconds（去重）
    const windowSet = new Set<number>()
    const rules = await this.loadRules()
    for (const rule of rules) {
      if (rule.enabled && (rule.code === 'frequency' || rule.code === 'ip_frequency')) {
        const ws = rule.params.windowSeconds || 60
        windowSet.add(ws)
      }
    }
    // 兜底：如果没有配置任何频率规则，至少用默认 60s
    if (windowSet.size === 0) windowSet.add(60)

    const nowSec = Math.floor(Date.now() / 1000)
    for (const ws of windowSet) {
      const bucket = Math.floor(nowSec / ws)
      // 用户频率计数：TTL 设为 ws*2，保证当前窗口和下一个窗口交界时仍有效
      const userKey = `risk:freq:${ctx.userId}:${ctx.type}:${ws}:${bucket}`
      await this.redis.incr(userKey, ws * 2)
      // IP 频率计数
      if (ctx.ip) {
        const ipKey = `risk:ipfreq:${ctx.ip}:${ws}:${bucket}`
        await this.redis.incr(ipKey, ws * 2)
      }
    }
  }
}
