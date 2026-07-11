import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { RedisService } from '../redis/redis.service'
import { FinanceService } from './finance.service'
import { DAY_MS } from '../common/constants'
import { ScheduleHealthService } from '../common/schedule-health.service'

// 调度互斥锁 TTL：5 分钟，保证多实例部署时同一时刻仅一个实例生成快照
const SCHED_LOCK_TTL_SECONDS = 5 * 60

@Injectable()
export class FinanceSchedule {
  private readonly logger = new Logger(FinanceSchedule.name)

  constructor(
    private readonly financeService: FinanceService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('finance:dailySnapshot', '0 1 * * *', '每日财务快照')
  }

  // 每天凌晨 1 点生成前一天的财务快照
  @Cron('0 1 * * *')
  async generateDailySnapshot() {
    const start = Date.now()
    const yesterday = new Date(Date.now() - DAY_MS)
      .toISOString()
      .slice(0, 10)

    this.scheduleHealth.reportStart('finance:dailySnapshot')

    // 多实例部署时通过分布式锁串行化，拿不到锁则跳过，避免并发生成快照
    if (!this.redis.isEnabled()) {
      await this.executeSnapshot(yesterday, start)
      return
    }
    try {
      await this.redis.withLock(
        `sched:snapshot:${yesterday}`,
        SCHED_LOCK_TTL_SECONDS,
        async () => {
          await this.executeSnapshot(yesterday, start)
        },
      )
    } catch (err) {
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete(
        'finance:dailySnapshot',
        false,
        duration,
        err instanceof Error ? err.message : String(err),
      )
      // 未获取到锁（其他实例正在执行）静默跳过
      this.logger.debug(
        `财务快照调度本轮跳过：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async executeSnapshot(yesterday: string, start: number) {
    try {
      const snapshot = await this.financeService.generateDailySnapshot(yesterday)
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('finance:dailySnapshot', true, duration)
      this.logger.log(`已生成 ${yesterday} 财务快照，耗时 ${duration}ms`)
      return snapshot
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('finance:dailySnapshot', false, duration, message)
      this.logger.error(`生成 ${yesterday} 财务快照失败`, err)
      throw err
    }
  }
}
