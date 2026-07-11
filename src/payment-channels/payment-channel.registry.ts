import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { PaymentChannel, ChannelConfig } from './payment-channel.interface'
import { MockChannel } from './channels/mock.channel'
import { WechatPayChannel } from './channels/wechat-pay.channel'
import { AlipayChannel } from './channels/alipay.channel'

/**
 * 支付渠道注册中心
 *
 * 负责渠道实例的注册、查找与配置加载。
 * 渠道配置存储在 PaymentChannelConfig 表中，config 字段为 JSON 字符串。
 *
 * 安全说明：生产环境不会降级到 mock 渠道，必须显式配置真实渠道。
 */
@Injectable()
export class PaymentChannelRegistry {
  private readonly logger = new Logger(PaymentChannelRegistry.name)
  private readonly channels = new Map<string, PaymentChannel>()
  private readonly isProduction: boolean

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    mockChannel: MockChannel,
    wechatPayChannel: WechatPayChannel,
    alipayChannel: AlipayChannel,
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV', 'development') === 'production'
    this.register(mockChannel)
    this.register(wechatPayChannel)
    this.register(alipayChannel)
  }

  register(channel: PaymentChannel) {
    this.channels.set(channel.code, channel)
    this.logger.log(`注册支付渠道: ${channel.code} (${channel.name})`)
  }

  getChannel(code: string): PaymentChannel {
    if (this.isProduction && code === 'mock') {
      this.logger.error('生产环境禁止使用 mock 渠道')
      throw new NotFoundException(`生产环境不支持渠道: ${code}`)
    }
    const channel = this.channels.get(code)
    if (!channel) {
      throw new NotFoundException(`支付渠道不存在: ${code}`)
    }
    return channel
  }

  /**
   * 获取已启用的渠道配置
   */
  async getEnabledConfig(code: string) {
    const config = await this.prisma.paymentChannelConfig.findUnique({
      where: { code },
    })
    if (!config || !config.enabled) {
      throw new NotFoundException(`支付渠道未启用: ${code}`)
    }
    let parsed: ChannelConfig = {}
    try {
      parsed = JSON.parse(config.config) as ChannelConfig
    } catch {
      this.logger.warn(`渠道 ${code} 配置解析失败，使用空配置`)
    }
    return {
      code: config.code,
      name: config.name,
      type: config.type,
      config: parsed,
    }
  }

  /**
   * 按类型获取优先级最高的启用渠道
   */
  async getChannelByType(type: 'RECHARGE' | 'PAYOUT'): Promise<{
    channel: PaymentChannel
    config: ChannelConfig
    code: string
  } | null> {
    const configs = await this.prisma.paymentChannelConfig.findMany({
      where: {
        enabled: true,
        OR: [{ type }, { type: 'BOTH' }],
      },
      orderBy: { priority: 'desc' },
    })

    for (const config of configs) {
      const channel = this.channels.get(config.code)
      if (channel) {
        let parsed: ChannelConfig = {}
        try {
          parsed = JSON.parse(config.config) as ChannelConfig
        } catch {
          // ignore
        }
        return { channel, config: parsed, code: config.code }
      }
    }

    // 没有配置渠道时，仅开发环境降级到 mock
    // 生产环境必须显式配置真实渠道，防止硬编码密钥泄露导致伪造回调
    if (!this.isProduction && this.channels.has('mock')) {
      this.logger.warn(`未配置${type}渠道，开发环境降级到 mock 渠道`)
      return {
        channel: this.channels.get('mock')!,
        config: {},
        code: 'mock',
      }
    }

    this.logger.error(`未配置可用的${type}渠道${this.isProduction ? '（生产环境不允许降级到 mock）' : ''}`)
    return null
  }
}
