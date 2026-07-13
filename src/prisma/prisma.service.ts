import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma')

  constructor() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL 未配置。本地开发请用 docker-compose.dev.yml 起 PostgreSQL，' +
        '或参考 .env.example 配置 DATABASE_URL=postgresql://...'
      )
    }
    if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
      throw new Error(
        `DATABASE_URL 必须是 postgresql:// 协议，当前值: ${databaseUrl.substring(0, 30)}...`
      )
    }

    // 显式配置连接池：避免多副本部署时每个 Node 进程拉满 PG 连接导致 too many connections 雪崩。
    // 默认 connectionLimit=5 适合单实例；多副本时按 PG max_connections / 副本数 调整。
    // statement_timeout=30s 防止慢查询挂死连接；pool_timeout=10s 获取连接超时快速失败。
    const connectionLimit = Number(process.env.DATABASE_CONNECTION_LIMIT) || 5
    const statementTimeoutMs = Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 30000
    const poolTimeoutSec = Number(process.env.DATABASE_POOL_TIMEOUT_SEC) || 10

    // 直接传对象字面量给 PrismaPg，让 TS 做结构兼容性检查；
    // 不显式声明 PoolConfig 类型，避免顶层 @types/pg 与 adapter 嵌套 @types/pg 的 Client 类型冲突。
    const adapter = new PrismaPg({
      connectionString: databaseUrl,
      max: connectionLimit,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: poolTimeoutSec * 1000,
      // statement_timeout 防止慢查询挂死连接，超时查询会被 PG 主动取消
      statement_timeout: statementTimeoutMs,
    })
    Logger.log(
      `Using PostgreSQL adapter (pool: max=${connectionLimit}, statement_timeout=${statementTimeoutMs}ms)`,
      'Prisma',
    )
    const isDev = process.env.NODE_ENV !== 'production'

    super({
      adapter,
      log: isDev
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'error' },
            { emit: 'stdout', level: 'warn' },
          ]
        : [
            { emit: 'stdout', level: 'error' },
          ],
    })

    if (isDev) {
      this.$on('query' as never, ((event: { query: string; duration: number; params: string }) => {
        if (event.duration > 1000) {
          this.logger.warn(
            `Slow query (${event.duration}ms): ${event.query.substring(0, 200)}`,
          )
        }
      }) as never)
    }
  }

  async onModuleInit() {
    await this.$connect()
    this.logger.log('Database connection established')
  }

  async onModuleDestroy() {
    await this.$disconnect()
    this.logger.log('Database connection closed')
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
