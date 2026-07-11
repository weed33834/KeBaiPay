import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { WithdrawalStatus } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { ChannelConfig } from '../payment-channels/payment-channel.interface'
import { ScheduleHealthService } from '../common/schedule-health.service'

/** PROCESSING 状态超过该时长视为异常，需兜底核对渠道真实状态 */
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000
/** 调度互斥锁 TTL：5 分钟（与 cron 周期一致，保证同一时刻仅一个实例执行） */
const SCHED_LOCK_TTL_SECONDS = 5 * 60

/** 超时核对所需的订单字段 */
interface TimeoutWithdrawalOrder {
  id: string
  orderNo: string
  userId: string
  amount: number
  channel: string | null
  channelOrderNo: string | null
}

@Injectable()
export class WithdrawalsSchedule {
  private readonly logger = new Logger(WithdrawalsSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('withdrawals:processingTimeout', '0 */5 * * * *', '提现超时兜底扫描')
  }

  // 每 5 分钟扫描 PROCESSING 超过 10 分钟的提现订单，调用渠道查询接口确认真实状态，
  // 防止进程崩溃导致订单永久卡在 PROCESSING、回调被拒、资金卡死。
  @Cron('0 */5 * * * *')
  async handleProcessingTimeout() {
    const start = Date.now()
    this.scheduleHealth.reportStart('withdrawals:processingTimeout')
    if (!this.redis.isEnabled()) {
      // 无 Redis 的单实例环境（本地开发/测试）无多实例并发风险，直接执行
      await this.scanTimeoutOrders().catch((err) =>
        this.logger.error('提现超时兜底扫描失败', err),
      )
      this.scheduleHealth.reportComplete('withdrawals:processingTimeout', true, Date.now() - start)
      return
    }
    try {
      await this.redis.withLock(
        'sched:withdrawal:timeout',
        SCHED_LOCK_TTL_SECONDS,
        async () => {
          await this.scanTimeoutOrders().catch((err) =>
            this.logger.error('提现超时兜底扫描失败', err),
          )
        },
      )
      this.scheduleHealth.reportComplete('withdrawals:processingTimeout', true, Date.now() - start)
    } catch (err) {
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('withdrawals:processingTimeout', false, duration, err instanceof Error ? err.message : String(err))
      // 未获取到锁（其他实例正在执行）静默跳过
      this.logger.debug(
        `提现超时兜底调度本轮跳过：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async scanTimeoutOrders() {
    const threshold = new Date(Date.now() - PROCESSING_TIMEOUT_MS)
    const orders = await this.prisma.withdrawalOrder.findMany({
      where: {
        status: WithdrawalStatus.PROCESSING,
        reviewedAt: { lt: threshold },
      },
    })

    if (orders.length === 0) return
    this.logger.log(
      `发现 ${orders.length} 笔 PROCESSING 超时提现订单，开始核对渠道状态`,
    )

    for (const order of orders) {
      try {
        await this.queryAndReconcile(order)
      } catch (err) {
        this.logger.error(`提现订单 ${order.orderNo} 超时核对失败`, err)
      }
    }
  }

  private async queryAndReconcile(order: TimeoutWithdrawalOrder) {
    // 无 channelOrderNo：approve 调用渠道后、持久化 channelOrderNo 前进程崩溃，
    // 订单卡死且回调无法匹配，仅告警待人工介入核实资金是否已代付
    if (!order.channel || !order.channelOrderNo) {
      this.logger.warn(
        `提现订单 ${order.orderNo} 处于 PROCESSING 超过 10 分钟且无渠道订单号，疑似渠道调用后崩溃，需人工核实资金是否已代付`,
      )
      return
    }

    let channel
    try {
      channel = this.channelRegistry.getChannel(order.channel)
    } catch {
      this.logger.warn(
        `提现订单 ${order.orderNo} 渠道 ${order.channel} 不存在，无法查询，需人工核实`,
      )
      return
    }

    let channelConfig: ChannelConfig = {}
    try {
      const entry = await this.channelRegistry.getEnabledConfig(order.channel)
      channelConfig = entry.config
    } catch {
      this.logger.warn(
        `提现订单 ${order.orderNo} 渠道 ${order.channel} 未启用或未配置，使用空配置查询`,
      )
    }

    const result = await channel.queryPayout(order.channelOrderNo, channelConfig)
    this.logger.log(
      `提现订单 ${order.orderNo} 渠道查询结果：${result.status}${result.message ? `（${result.message}）` : ''}`,
    )

    // 仅查询并记录真实状态，不在此处自动改单，避免与代付回调并发修改状态引入新竞态。
    // 异常情况告警，由对账/人工通过回调或调账流程处理，确保资金不长期卡死。
    if (result.status === 'SUCCESS') {
      this.logger.warn(
        `提现订单 ${order.orderNo} 渠道已代付成功但本地仍 PROCESSING，疑似回调丢失，请核实并补单`,
      )
    } else if (result.status === 'FAILED') {
      this.logger.warn(
        `提现订单 ${order.orderNo} 渠道代付失败，请核实后通过回调或人工流程退款`,
      )
    }
  }
}
