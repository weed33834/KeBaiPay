import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CashierService } from './cashier.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

@Injectable()
export class CashierSchedule {
  private readonly logger = new Logger(CashierSchedule.name)

  constructor(
    private readonly cashierService: CashierService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('cashier:closeExpired', '0 */5 * * * *', '关闭过期未支付订单')
  }

  // 每 5 分钟关闭过期未支付订单，复用 service 逻辑避免重复代码
  @Cron('0 */5 * * * *')
  async closeExpiredOrders() {
    const start = Date.now()
    this.scheduleHealth.reportStart('cashier:closeExpired')
    try {
      await this.cashierService.closeExpiredOrders()
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('cashier:closeExpired', true, duration)
      this.logger.debug(`过期订单扫描完成，耗时 ${duration}ms`)
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('cashier:closeExpired', false, duration, message)
      this.logger.error('关闭过期订单失败', err)
    }
  }
}
