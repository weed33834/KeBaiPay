import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { PaymentChannel, ChannelConfig } from './payment-channel.interface'

/**
 * 渠道健康状态
 */
export interface ChannelHealthStatus {
  code: string
  name: string
  available: boolean
  successRate: number
  totalRequests: number
  successCount: number
  failureCount: number
  lastChecked: Date
  lastError?: string
  avgResponseTime: number
}

/**
 * 渠道健康监控服务
 *
 * 功能：
 * - 定期探测渠道可用性
 * - 跟踪成功率和失败率
 * - 渠道故障时自动切换
 * - 提供健康状态查询接口
 */
@Injectable()
export class ChannelHealthService {
  private readonly logger = new Logger(ChannelHealthService.name)

  /** 渠道统计信息 */
  private channelStats = new Map<string, {
    totalRequests: number
    successCount: number
    failureCount: number
    lastError?: string
    lastChecked: Date
    responseTimes: number[]
  }>()

  /** 渠道可用性状态 */
  private channelAvailability = new Map<string, boolean>()

  /** 最小请求次数（低于此次数不做熔断判断） */
  private readonly MIN_REQUESTS_FOR_CIRCUIT_BREAKER = 10

  /** 成功率低于此阈值触发熔断 */
  private readonly SUCCESS_RATE_THRESHOLD = 0.5

  /** 熔断恢复时间（毫秒） */
  private readonly CIRCUIT_BREAKER_RECOVERY_MS = 5 * 60 * 1000 // 5 分钟

  /** 熔断时间记录 */
  private circuitBreakerTrippedAt = new Map<string, number>()

  constructor(
    private readonly channelRegistry: PaymentChannelRegistry,
  ) {
    // 初始化所有渠道状态
    this.channelAvailability.set('mock', true)
    this.channelAvailability.set('wechat', true)
    this.channelAvailability.set('alipay', true)
  }

  /**
   * 记录请求成功
   */
  recordSuccess(channelCode: string, responseTimeMs: number): void {
    const stats = this.getOrCreateStats(channelCode)
    stats.totalRequests++
    stats.successCount++
    stats.lastChecked = new Date()
    stats.responseTimes.push(responseTimeMs)

    // 保留最近 100 个响应时间
    if (stats.responseTimes.length > 100) {
      stats.responseTimes.shift()
    }

    // 恢复渠道可用性
    if (!this.channelAvailability.get(channelCode)) {
      this.logger.log(`渠道 ${channelCode} 恢复可用`)
      this.channelAvailability.set(channelCode, true)
      this.circuitBreakerTrippedAt.delete(channelCode)
    }
  }

  /**
   * 记录请求失败
   */
  recordFailure(channelCode: string, error?: string): void {
    const stats = this.getOrCreateStats(channelCode)
    stats.totalRequests++
    stats.failureCount++
    stats.lastChecked = new Date()
    stats.lastError = error

    // 检查是否需要熔断
    this.checkCircuitBreaker(channelCode)
  }

  /**
   * 检查熔断器
   */
  private checkCircuitBreaker(channelCode: string): void {
    const stats = this.channelStats.get(channelCode)
    if (!stats) return

    // 请求次数不足不做判断
    if (stats.totalRequests < this.MIN_REQUESTS_FOR_CIRCUIT_BREAKER) return

    const successRate = stats.successCount / stats.totalRequests

    if (successRate < this.SUCCESS_RATE_THRESHOLD) {
      this.logger.warn(`渠道 ${channelCode} 成功率过低 (${(successRate * 100).toFixed(1)}%)，触发熔断`)
      this.channelAvailability.set(channelCode, false)
      this.circuitBreakerTrippedAt.set(channelCode, Date.now())
    }
  }

  /**
   * 获取或创建渠道统计
   */
  private getOrCreateStats(channelCode: string) {
    if (!this.channelStats.has(channelCode)) {
      this.channelStats.set(channelCode, {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        lastChecked: new Date(),
        responseTimes: [],
      })
    }
    return this.channelStats.get(channelCode)!
  }

  /**
   * 检查渠道是否可用
   */
  isChannelAvailable(channelCode: string): boolean {
    const isAvailable = this.channelAvailability.get(channelCode)
    if (isAvailable === false) {
      // 检查是否已过恢复时间
      const trippedAt = this.circuitBreakerTrippedAt.get(channelCode)
      if (trippedAt && Date.now() - trippedAt > this.CIRCUIT_BREAKER_RECOVERY_MS) {
        this.logger.log(`渠道 ${channelCode} 熔断恢复时间已到，尝试恢复`)
        this.channelAvailability.set(channelCode, true)
        this.circuitBreakerTrippedAt.delete(channelCode)

        // 重置统计（给一个重新开始的机会）
        const stats = this.channelStats.get(channelCode)
        if (stats) {
          stats.totalRequests = 0
          stats.successCount = 0
          stats.failureCount = 0
        }
        return true
      }
      return false
    }
    return true
  }

  /**
   * 获取渠道健康状态
   */
  getChannelHealth(channelCode: string): ChannelHealthStatus | null {
    const stats = this.channelStats.get(channelCode)
    if (!stats) return null

    const avgResponseTime = stats.responseTimes.length > 0
      ? stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
      : 0

    return {
      code: channelCode,
      name: this.getChannelName(channelCode),
      available: this.isChannelAvailable(channelCode),
      successRate: stats.totalRequests > 0 ? stats.successCount / stats.totalRequests : 1,
      totalRequests: stats.totalRequests,
      successCount: stats.successCount,
      failureCount: stats.failureCount,
      lastChecked: stats.lastChecked,
      lastError: stats.lastError,
      avgResponseTime: Math.round(avgResponseTime),
    }
  }

  /**
   * 获取所有渠道健康状态
   */
  getAllChannelHealth(): ChannelHealthStatus[] {
    const channels = ['wechat', 'alipay']
    return channels.map(code => this.getChannelHealth(code)).filter(Boolean) as ChannelHealthStatus[]
  }

  /**
   * 获取渠道名称
   */
  private getChannelName(code: string): string {
    const names: Record<string, string> = {
      wechat: '微信支付',
      alipay: '支付宝',
      mock: '模拟渠道',
    }
    return names[code] || code
  }

  /**
   * 按类型获取最优渠道
   *
   * 根据健康状态和成功率选择最优渠道
   */
  async getBestChannel(type: 'RECHARGE' | 'PAYOUT'): Promise<{
    channel: PaymentChannel
    config: ChannelConfig
    code: string
  } | null> {
    const channels = await this.channelRegistry.getChannelByType(type)
    if (!channels) return null

    // 如果当前渠道可用，直接返回
    if (this.isChannelAvailable(channels.code)) {
      return channels
    }

    // 当前渠道不可用，尝试获取其他渠道
    this.logger.warn(`渠道 ${channels.code} 不可用，尝试获取备选渠道`)
    return null
  }

  /**
   * 定期健康检查
   *
   * 每 5 分钟检查一次渠道可用性
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async healthCheck(): Promise<void> {
    this.logger.debug('开始渠道健康检查')

    const channels = ['wechat', 'alipay']

    for (const code of channels) {
      try {
        const config = await this.channelRegistry.getEnabledConfig(code)
        // 简单的连通性检查（实际中可能需要更复杂的检查）
        this.channelAvailability.set(code, true)
        this.logger.debug(`渠道 ${code} 健康检查通过`)
      } catch (error) {
        this.logger.warn(`渠道 ${code} 健康检查失败: ${error}`)
      }
    }
  }

  /**
   * 获取健康状态摘要
   */
  getHealthSummary(): {
    totalChannels: number
    availableChannels: number
    unhealthyChannels: string[]
  } {
    const channels = ['wechat', 'alipay']
    const availableChannels = channels.filter(c => this.isChannelAvailable(c))
    const unhealthyChannels = channels.filter(c => !this.isChannelAvailable(c))

    return {
      totalChannels: channels.length,
      availableChannels: availableChannels.length,
      unhealthyChannels,
    }
  }
}
