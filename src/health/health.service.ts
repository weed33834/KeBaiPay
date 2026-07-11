import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

export interface HealthCheckResult {
  status: 'ok' | 'error'
  timestamp: string
  uptime: number
  checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; message?: string }>
}

/** 就绪探针对外返回结构：仅暴露 status，避免泄露依赖细节（延迟、错误消息）给外部 */
export interface ReadinessResult {
  status: 'ok' | 'error'
  timestamp: string
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)
  private readonly startedAt = Date.now()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 存活探针：进程在跑即为 ok */
  liveness(): HealthCheckResult {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: {},
    }
  }

  /**
   * 就绪探针：检查关键依赖（DB、Redis）是否可用。
   * 对外仅返回 status，依赖细节（延迟、错误消息）仅记录日志，
   * 避免攻击者通过 /health/ready 探测系统依赖状态与拓扑。
   */
  async readiness(): Promise<ReadinessResult> {
    const checks: HealthCheckResult['checks'] = {}

    // 数据库检查
    checks.database = await this.checkDatabase()

    // Redis 检查（未配置时标记为 skipped，降级允许）
    checks.redis = await this.checkRedis()

    const allOk = Object.values(checks).every((c) => c.status === 'ok')
    const status: 'ok' | 'error' = allOk ? 'ok' : 'error'

    // 依赖检查细节仅记录日志，不对外暴露
    if (allOk) {
      this.logger.debug(`就绪检查通过: ${JSON.stringify(checks)}`)
    } else {
      this.logger.warn(`就绪检查未通过: ${JSON.stringify(checks)}`)
    }

    return {
      status,
      timestamp: new Date().toISOString(),
    }
  }

  private async checkDatabase(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; message?: string }> {
    const start = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ok', latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`数据库健康检查失败: ${message}`)
      return { status: 'error', latencyMs: Date.now() - start, message }
    }
  }

  private async checkRedis(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; message?: string }> {
    const isProduction = process.env.NODE_ENV === 'production'
    const start = Date.now()

    if (!this.redis.isEnabled()) {
      if (isProduction) {
        this.logger.error('Redis 未配置，生产环境就绪检查失败')
        return { status: 'error', message: 'Redis 未配置，生产环境必须配置' }
      }
      return { status: 'ok', message: '未配置 Redis，已降级为进程内实现', latencyMs: Date.now() - start }
    }

    try {
      const pong = await this.redis.ping()
      return { status: pong === 'PONG' ? 'ok' : 'error', latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Redis 健康检查失败: ${message}`)
      return { status: 'error', latencyMs: Date.now() - start, message }
    }
  }
}
