import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CouponsService } from './coupons.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

@Injectable()
export class CouponsSchedule {
  private readonly logger = new Logger(CouponsSchedule.name)

  constructor(
    private readonly couponsService: CouponsService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register(
      'coupons:auto-expire',
      '0 0 * * * *',
      '优惠券自动过期扫描',
    )
  }

  /** 每小时扫描：过期优惠券标记为 EXPIRED */
  @Cron('0 0 * * * *')
  async autoExpire() {
    const start = Date.now()
    this.scheduleHealth.reportStart('coupons:auto-expire')
    try {
      const count = await this.couponsService.autoExpire()
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('coupons:auto-expire', true, duration)
      if (count > 0) {
        this.logger.log(`优惠券自动过期：标记 ${count} 张过期`)
      }
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('coupons:auto-expire', false, duration, message)
      this.logger.error('优惠券自动过期扫描异常', err)
    }
  }
}
