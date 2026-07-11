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

    const adapter = new PrismaPg(databaseUrl)
    Logger.log('Using PostgreSQL adapter', 'Prisma')
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
