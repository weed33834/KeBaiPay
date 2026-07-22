import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { EscrowService } from './escrow.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

@Injectable()
export class EscrowSchedule {
  private readonly logger = new Logger(EscrowSchedule.name)

  constructor(
    private readonly escrowService: EscrowService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('escrow:auto-expire', '0 */5 * * * *', '担保订单超时未付款自动取消')
    this.scheduleHealth.register('escrow:auto-confirm', '0 0 * * * *', '担保订单发货后超时自动放款')
  }

  /** 每 5 分钟扫描：超时未付款的 CREATED 订单标记为 EXPIRED */
  @Cron('0 */5 * * * *')
  async autoExpire() {
    const start = Date.now()
    this.scheduleHealth.reportStart('escrow:auto-expire')
    try {
      const count = await this.escrowService.autoExpire()
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('escrow:auto-expire', true, duration)
      if (count > 0) {
        this.logger.log(`担保订单超时扫描：自动取消 ${count} 单`)
      }
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('escrow:auto-expire', false, duration, message)
      this.logger.error('担保订单超时扫描异常', err)
    }
  }

  /** 每小时扫描：SHIPPED 超过 7 天未确认 → 自动放款 */
  @Cron('0 0 * * * *')
  async autoConfirm() {
    const start = Date.now()
    this.scheduleHealth.reportStart('escrow:auto-confirm')
    try {
      const count = await this.escrowService.autoConfirm()
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('escrow:auto-confirm', true, duration)
      if (count > 0) {
        this.logger.log(`担保订单自动放款：处理 ${count} 单`)
      }
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('escrow:auto-confirm', false, duration, message)
      this.logger.error('担保订单自动放款扫描异常', err)
    }
  }
}
