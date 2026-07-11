import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { RiskEventType, RiskLevel } from '../common/enums'
import { AuditLogService } from './audit-log.service'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 审计链定时校验任务
 *
 * 每天凌晨 3 点全量校验审计日志哈希链完整性；
 * 发现异常时创建 RiskEvent 告警，便于运维及时介入。
 */
@Injectable()
export class AuditSchedule {
  private readonly logger = new Logger(AuditSchedule.name)

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // 每天凌晨 3 点执行审计链校验
  @Cron('0 3 * * *')
  async verifyChain() {
    try {
      const brokenId = await this.auditLogService.verifyChain()
      if (brokenId) {
        this.logger.error(
          `审计链校验发现异常，首条异常日志 id：${brokenId}`,
        )
        await this.createAuditAlert(brokenId)
      } else {
        this.logger.log('审计链校验通过，无异常')
      }
    } catch (err) {
      this.logger.error(
        `审计链校验执行失败：${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  }

  /**
   * 创建审计链异常 RiskEvent 告警
   *
   * RiskEvent 模型要求关联一个 userId，审计链异常属于系统级告警，
   * 这里选取系统内最早创建的用户作为告警归属；
   * 若系统尚无任何用户则仅记录日志，避免外键约束失败。
   */
  private async createAuditAlert(brokenLogId: string): Promise<void> {
    const anchorUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!anchorUser) {
      this.logger.warn(
        '系统内尚无用户，审计链异常 RiskEvent 未创建',
      )
      return
    }
    await this.prisma.riskEvent.create({
      data: {
        userId: anchorUser.id,
        type: RiskEventType.SUSPICIOUS_DEVICE,
        level: RiskLevel.HIGH,
        description: `审计链校验异常：日志 ${brokenLogId} 可能被篡改，请立即排查`,
      },
    })
  }
}
