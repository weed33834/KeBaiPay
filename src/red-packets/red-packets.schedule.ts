import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { RedPacketStatus } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedPacketsService } from './red-packets.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

@Injectable()
export class RedPacketsSchedule {
  private readonly logger = new Logger(RedPacketsSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redPacketsService: RedPacketsService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('red-packets:expire', '0 */5 * * * *', '过期红包退回')
  }

  @Cron('0 */5 * * * *')
  async expireRedPackets() {
    const start = Date.now()
    this.scheduleHealth.reportStart('red-packets:expire')
    try {
      const now = new Date()
      const pendingPackets = await this.prisma.redPacket.findMany({
        where: {
          status: { in: [RedPacketStatus.PENDING, RedPacketStatus.PARTIALLY_RECEIVED] },
          expiresAt: { lt: now },
        },
      })

      if (pendingPackets.length === 0) {
        const duration = Date.now() - start
        this.scheduleHealth.reportComplete('red-packets:expire', true, duration)
        this.logger.debug(`红包过期扫描完成，无需处理，耗时 ${duration}ms`)
        return
      }

      let successCount = 0
      let failCount = 0
      for (const packet of pendingPackets) {
        try {
          await this.redPacketsService.expireReturn(packet.id)
          successCount++
          this.logger.log(`红包 ${packet.packetNo} 已过期退回`)
        } catch (err) {
          failCount++
          this.logger.error(`红包 ${packet.packetNo} 退回失败`, err)
        }
      }

      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('red-packets:expire', failCount === 0, duration)
      this.logger.log(
        `红包过期扫描完成: 总计 ${pendingPackets.length}, 成功 ${successCount}, 失败 ${failCount}, 耗时 ${duration}ms`,
      )
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('red-packets:expire', false, duration, message)
      this.logger.error('红包过期扫描异常', err)
    }
  }
}
