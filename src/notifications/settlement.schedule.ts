import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { SettlementService } from './settlement.service'
import { RedisService } from '../redis/redis.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

@Injectable()
export class SettlementSchedule {
  private readonly logger = new Logger(SettlementSchedule.name)

  constructor(
    private readonly settlement: SettlementService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('settlement:daily', '0 3 * * *', '每日 T+1 结算')
  }

  @Cron('0 3 * * *') // 每天凌晨 3 点执行 T+1 结算
  async handleSettlement() {
    const start = Date.now()
    const lockKey = 'settlement:daily'
    this.scheduleHealth.reportStart('settlement:daily')
    try {
      // 锁 TTL 单位是秒，300 秒 = 5 分钟（与 cron 周期匹配）；误传 300_000 会占锁 3.47 天
      await this.redis.withLock(lockKey, 300, async () => {
        this.logger.log('开始执行每日 T+1 结算任务...')
        try {
          const results = await this.settlement.runDailySettlement()
          const success = results.filter((r) => r.status === 'SUCCESS').length
          const failed = results.filter((r) => r.status === 'ERROR').length
          const duration = Date.now() - start
          this.scheduleHealth.reportComplete('settlement:daily', failed === 0, duration)
          this.logger.log(`结算任务完成: 成功 ${success}, 失败 ${failed}, 耗时 ${duration}ms`)
        } catch (err) {
          const duration = Date.now() - start
          const message = err instanceof Error ? err.message : String(err)
          this.scheduleHealth.reportComplete('settlement:daily', false, duration, message)
          this.logger.error('结算任务异常', (err as Error).stack)
        }
      })
    } catch {
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('settlement:daily', false, duration, '获取锁失败')
      this.logger.warn('结算任务获取锁失败，可能其他实例正在执行')
    }
  }
}
