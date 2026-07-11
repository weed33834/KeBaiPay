import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { TransactionStatus, TransactionType } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

/** PENDING 状态超过该时长视为异常，需核实渠道真实状态 */
const PENDING_TIMEOUT_MS = 15 * 60 * 1000
/** 调度互斥锁 TTL：5 分钟（与 cron 周期一致，保证同一时刻仅一个实例执行） */
const SCHED_LOCK_TTL_SECONDS = 5 * 60

@Injectable()
export class TransactionsSchedule {
  private readonly logger = new Logger(TransactionsSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('transactions:rechargeTimeout', '0 */5 * * * *', '充值超时兜底扫描')
  }

  // 每 5 分钟扫描 PENDING 超过 15 分钟的充值订单，告警由人工/对账核实渠道真实状态，
  // 防止渠道调用后进程崩溃导致订单永久卡在 PENDING、回调被拒、资金/订单状态不一致。
  @Cron('0 */5 * * * *')
  async handleRechargeTimeout() {
    const start = Date.now()
    this.scheduleHealth.reportStart('transactions:rechargeTimeout')
    if (!this.redis.isEnabled()) {
      // 无 Redis 的单实例环境（本地开发/测试）无多实例并发风险，直接执行
      await this.scanTimeoutOrders().catch((err) =>
        this.logger.error('充值超时兜底扫描失败', err),
      )
      this.scheduleHealth.reportComplete('transactions:rechargeTimeout', true, Date.now() - start)
      return
    }
    try {
      await this.redis.withLock(
        'sched:recharge:timeout',
        SCHED_LOCK_TTL_SECONDS,
        async () => {
          await this.scanTimeoutOrders().catch((err) =>
            this.logger.error('充值超时兜底扫描失败', err),
          )
        },
      )
      this.scheduleHealth.reportComplete('transactions:rechargeTimeout', true, Date.now() - start)
    } catch (err) {
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('transactions:rechargeTimeout', false, duration, err instanceof Error ? err.message : String(err))
      // 未获取到锁（其他实例正在执行）静默跳过
      this.logger.debug(
        `充值超时兜底调度本轮跳过：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async scanTimeoutOrders() {
    const threshold = new Date(Date.now() - PENDING_TIMEOUT_MS)
    const orders = await this.prisma.transactionOrder.findMany({
      where: {
        type: TransactionType.RECHARGE,
        status: TransactionStatus.PENDING,
        createdAt: { lt: threshold },
      },
    })

    if (orders.length === 0) return
    this.logger.log(
      `发现 ${orders.length} 笔 PENDING 超过 15 分钟的充值订单，需核实渠道真实状态`,
    )

    for (const order of orders) {
      // 当前渠道接口未提供 queryRecharge 查询能力，无法主动查询渠道真实状态，
      // 仅告警待人工/对账处理（与 withdrawals 兜底一致：无查询接口则记录日志告警）。
      if (!order.channelOrderNo) {
        // 无 channelOrderNo：渠道调用成功后、持久化 channelOrderNo 前进程崩溃，
        // 回调将因 channelOrderNo 不匹配被拒（由 handleRechargeCallback 兜底补录覆盖正常回调，
        // 若回调未到达则订单卡死，需人工核实是否已支付）
        this.logger.warn(
          `充值订单 ${order.orderNo} 处于 PENDING 超过 15 分钟且无渠道订单号，疑似渠道调用后崩溃，需人工核实是否已支付`,
        )
      } else {
        this.logger.warn(
          `充值订单 ${order.orderNo}（渠道单号 ${order.channelOrderNo}）处于 PENDING 超过 15 分钟，疑似回调丢失，需人工核实渠道真实状态并补单`,
        )
      }
    }
  }
}
