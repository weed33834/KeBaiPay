import { Injectable, Logger } from '@nestjs/common'

export interface ScheduleRecord {
  name: string
  cronExpression: string
  description: string
  lastExecution?: string
  lastDurationMs?: number
  lastSuccess?: boolean
  lastError?: string
  totalExecutions: number
  totalFailures: number
  consecutiveFailures: number
  isRunning: boolean
}

export interface ScheduleHealthSummary {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  totalSchedules: number
  healthySchedules: number
  degradedSchedules: number
  errorSchedules: number
  schedules: ScheduleRecord[]
}

@Injectable()
export class ScheduleHealthService {
  private readonly logger = new Logger(ScheduleHealthService.name)
  private readonly records = new Map<string, ScheduleRecord>()

  register(name: string, cronExpression: string, description: string) {
    if (this.records.has(name)) return
    this.records.set(name, {
      name,
      cronExpression,
      description,
      totalExecutions: 0,
      totalFailures: 0,
      consecutiveFailures: 0,
      isRunning: false,
    })
    this.logger.debug(`调度任务已注册: ${name} (${cronExpression})`)
  }

  reportStart(name: string) {
    const record = this.records.get(name)
    if (!record) {
      this.logger.warn(`未注册的调度任务开始执行: ${name}`)
      return
    }
    record.isRunning = true
  }

  reportComplete(name: string, success: boolean, durationMs: number, error?: string) {
    const record = this.records.get(name)
    if (!record) {
      this.logger.warn(`未注册的调度任务完成: ${name}`)
      return
    }
    record.isRunning = false
    record.lastExecution = new Date().toISOString()
    record.lastDurationMs = durationMs
    record.lastSuccess = success
    record.lastError = error
    record.totalExecutions++
    if (success) {
      record.consecutiveFailures = 0
    } else {
      record.totalFailures++
      record.consecutiveFailures++
      if (record.consecutiveFailures >= 3) {
        this.logger.error(
          `调度任务 ${name} 连续失败 ${record.consecutiveFailures} 次，请检查`,
        )
      }
    }
  }

  getScheduleStatus(): ScheduleHealthSummary {
    const schedules = Array.from(this.records.values())
    const errorSchedules = schedules.filter(
      (s) => s.consecutiveFailures >= 3,
    )
    const degradedSchedules = schedules.filter(
      (s) => s.consecutiveFailures > 0 && s.consecutiveFailures < 3,
    )
    const healthySchedules = schedules.filter(
      (s) => s.consecutiveFailures === 0,
    )

    let status: 'ok' | 'degraded' | 'error' = 'ok'
    if (errorSchedules.length > 0) status = 'error'
    else if (degradedSchedules.length > 0) status = 'degraded'

    return {
      status,
      timestamp: new Date().toISOString(),
      totalSchedules: schedules.length,
      healthySchedules: healthySchedules.length,
      degradedSchedules: degradedSchedules.length,
      errorSchedules: errorSchedules.length,
      schedules,
    }
  }

  getRecords(): ScheduleRecord[] {
    return Array.from(this.records.values())
  }
}
