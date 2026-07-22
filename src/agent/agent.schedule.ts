import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { LlmService } from './llm/llm.service'
import { MessagesService } from '../messages/messages.service'

/**
 * Agent 调度任务：
 *  1. 每 10 分钟巡检 ScheduleHealthService，发现连续失败 ≥3 次的任务时 AI 生成告警并推送管理员
 *  2. 每小时扫描 ReconciliationDifferenceItem PENDING 项，AI 生成处置建议
 *  3. 每 30 分钟扫描 RiskEvent REVIEW 状态，AI 生成处置建议
 *
 * 巡检任务本身也注册到 ScheduleHealthService，被自身监控（防止巡检自身失败无人发现）
 */
@Injectable()
export class AgentSchedule {
  private readonly logger = new Logger(AgentSchedule.name)
  private static readonly TASK_HEALTH_CHECK = 'agent:health-check'
  private static readonly TASK_RECONCILE_SCAN = 'agent:reconcile-scan'
  private static readonly TASK_RISK_SCAN = 'agent:risk-scan'

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleHealth: ScheduleHealthService,
    private readonly llm: LlmService,
    private readonly messagesService: MessagesService,
  ) {
    // 注册三个巡检任务到健康监控
    this.scheduleHealth.register(
      AgentSchedule.TASK_HEALTH_CHECK,
      CronExpression.EVERY_10_MINUTES,
      'AI 巡检：系统健康与调度任务异常告警',
    )
    this.scheduleHealth.register(
      AgentSchedule.TASK_RECONCILE_SCAN,
      CronExpression.EVERY_HOUR,
      'AI 巡检：对账差异自动调查',
    )
    this.scheduleHealth.register(
      AgentSchedule.TASK_RISK_SCAN,
      '0 */30 * * * *',
      'AI 巡检：风控事件扫描',
    )
  }

  /** 每 10 分钟巡检调度健康 */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkSystemHealth() {
    const start = Date.now()
    this.scheduleHealth.reportStart(AgentSchedule.TASK_HEALTH_CHECK)
    try {
      const status = this.scheduleHealth.getScheduleStatus()
      if (status.status === 'ok') {
        this.scheduleHealth.reportComplete(AgentSchedule.TASK_HEALTH_CHECK, true, Date.now() - start)
        return
      }
      // 发现异常：用 LLM 生成告警报告
      // ScheduleRecord 没有 status 字段，用 consecutiveFailures 判断
      const errorSchedules = status.schedules.filter((s) => s.consecutiveFailures >= 3)
      const degraded = status.schedules.filter((s) => s.consecutiveFailures > 0 && s.consecutiveFailures < 3)
      if (errorSchedules.length === 0 && degraded.length === 0) {
        this.scheduleHealth.reportComplete(AgentSchedule.TASK_HEALTH_CHECK, true, Date.now() - start)
        return
      }

      const prompt = `作为 KeBaiPay 风控审计官，分析以下系统健康异常：

错误任务（连续失败 ≥3 次）：
${errorSchedules.map((s) => `- ${s.name}（${s.cronExpression}）：${s.description}，最近错误：${s.lastError ?? '未知'}`).join('\n')}

降级任务（连续失败 1-2 次）：
${degraded.map((s) => `- ${s.name}：${s.lastError ?? '未知'}`).join('\n')}

请给出：
1. 异常根因分析
2. 处置建议（是否需要禁用相关功能、是否需要立即介入）
3. 优先级排序

用简洁的中文输出，适合运维人员阅读。`

      const result = await this.llm.chat({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '你是 KeBaiPay 平台运维 AI 助手，负责监控系统健康并生成告警报告。',
      })

      // 推送给所有 SUPER_ADMIN
      const admins = await this.prisma.adminUser.findMany({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      })
      // AdminUser 没有 userId，无法直接推送站内消息；记录到日志供运维查询
      this.logger.warn(
        `AI 巡检发现 ${errorSchedules.length} 个错误任务，${degraded.length} 个降级任务，` +
        `涉及管理员 ${admins.length} 名。报告：${result.content}`,
      )
      this.scheduleHealth.reportComplete(AgentSchedule.TASK_HEALTH_CHECK, true, Date.now() - start)
    } catch (err: any) {
      this.scheduleHealth.reportComplete(
        AgentSchedule.TASK_HEALTH_CHECK, false, Date.now() - start, err.message,
      )
      this.logger.error(`AI 巡检失败：${err.message}`, err.stack)
    }
  }

  /** 每小时扫描对账差异 */
  @Cron(CronExpression.EVERY_HOUR)
  async scanReconciliationDiffs() {
    const start = Date.now()
    this.scheduleHealth.reportStart(AgentSchedule.TASK_RECONCILE_SCAN)
    try {
      const pendingDiffs = await this.prisma.reconciliationDifferenceItem.findMany({
        where: { status: 'PENDING' },
        take: 20,
        orderBy: { createdAt: 'desc' },
      })
      if (pendingDiffs.length === 0) {
        this.scheduleHealth.reportComplete(AgentSchedule.TASK_RECONCILE_SCAN, true, Date.now() - start)
        return
      }

      const prompt = `作为对账审计 AI，分析以下 PENDING 状态的对账差异项，给出处置建议：

${pendingDiffs.map((d) => `- ID: ${d.id}，类型: ${d.diffType}，金额: ${d.amount ?? 'N/A'}，渠道: ${d.channelCode ?? 'N/A'}`).join('\n')}

请分类：
1. 应自动解决（如回调延迟导致）
2. 需人工介入（如金额不一致）
3. 建议标记为 IGNORED 的误报

输出格式：每条差异的 ID + 处置建议。`

      const result = await this.llm.chat({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '你是 KeBaiPay 对账审计 AI。',
      })

      this.logger.log(`AI 扫描 ${pendingDiffs.length} 个对账差异，建议：${result.content}`)
      this.scheduleHealth.reportComplete(AgentSchedule.TASK_RECONCILE_SCAN, true, Date.now() - start)
    } catch (err: any) {
      this.scheduleHealth.reportComplete(
        AgentSchedule.TASK_RECONCILE_SCAN, false, Date.now() - start, err.message,
      )
      this.logger.error(`AI 对账差异扫描失败：${err.message}`, err.stack)
    }
  }

  /** 每 30 分钟扫描风控事件 */
  @Cron('0 */30 * * * *')
  async scanRiskEvents() {
    const start = Date.now()
    this.scheduleHealth.reportStart(AgentSchedule.TASK_RISK_SCAN)
    try {
      const reviewEvents = await this.prisma.riskEvent.findMany({
        where: { handled: false, level: 'HIGH' },
        take: 20,
        orderBy: { createdAt: 'desc' },
      })
      if (reviewEvents.length === 0) {
        this.scheduleHealth.reportComplete(AgentSchedule.TASK_RISK_SCAN, true, Date.now() - start)
        return
      }

      const prompt = `作为风控审计 AI，分析以下 HIGH 级别未处理风控事件：

${reviewEvents.map((e) => `- ID: ${e.id}，类型: ${e.type}，用户: ${e.userId}，描述: ${e.description ?? '无'}`).join('\n')}

请给出：
1. 是否为误报判断
2. 建议处置动作（继续观察/限制交易/冻结账户）
3. 是否需要立即人工介入

输出简洁的中文报告。`

      const result = await this.llm.chat({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '你是 KeBaiPay 风控审计官，负责分析高风险事件并给出处置建议。',
      })

      this.logger.log(`AI 扫描 ${reviewEvents.length} 个高风险事件，建议：${result.content}`)
      this.scheduleHealth.reportComplete(AgentSchedule.TASK_RISK_SCAN, true, Date.now() - start)
    } catch (err: any) {
      this.scheduleHealth.reportComplete(
        AgentSchedule.TASK_RISK_SCAN, false, Date.now() - start, err.message,
      )
      this.logger.error(`AI 风控扫描失败：${err.message}`, err.stack)
    }
  }
}
