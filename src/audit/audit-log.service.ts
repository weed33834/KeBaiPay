import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'

/**
 * 审计日志服务
 *
 * 通过哈希链实现防篡改：
 * - 每条日志的 hash = SHA256(previousHash + 内容)
 * - 任何对历史日志的修改都会导致后续所有日志的 previousHash 不匹配
 * - 提供 verifyChain 方法校验日志链完整性
 *
 * 适用于敏感操作归档：调账、用户状态变更、风控等级变更、实名审核等
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name)
  // 创世哈希，链条起点
  private readonly GENESIS_HASH = '0'.repeat(64)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录敏感操作日志（带哈希链）
   *
   * @param tx 可选的事务客户端，传入时日志在事务内写入
   */
  async log(
    params: {
      adminId: string
      action: string
      target?: string | null
      detail?: unknown
      ip?: string
      userAgent?: string
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const { adminId, action, target, detail, ip, userAgent } = params

    // 哈希链写入核心逻辑：读取上一条 hash → 计算当前 hash → 持久化
    const doLog = async (client: Prisma.TransactionClient | PrismaService) => {
      // 获取上一条日志的 hash
      // H6: createdAt 仅毫秒精度，同毫秒并发写入时物理顺序不保证 = 写入顺序，
      // 改用 seq 单调递增序列号排序。旧数据 seq 可能为 null（nulls last 让非 null 的最新记录排在前），
      // 全部为 null 时回退 createdAt 排序，保证取到真正最后一条。
      const lastLog = await client.adminOperationLog.findFirst({
        orderBy: [{ seq: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: { hash: true },
      })
      const previousHash = lastLog?.hash || this.GENESIS_HASH

      // 计算当前日志的 hash（仅使用持久化字段，便于后续校验内容完整性）
      // userAgent 纳入 hash 防止 DB 攻击者篡改 userAgent 而不破坏哈希链
      const content = JSON.stringify({
        adminId,
        action,
        target: target ?? null,
        detail: detail == null ? null : JSON.stringify(detail),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        previousHash,
      })
      const hash = createHash('sha256').update(content).digest('hex')

      // 写入失败必须抛出异常：资金类操作（调账、提现审核、用户状态变更）的审计日志
      // 是合规与追责的最后一道凭证，丢失会让资金操作无法追溯。
      // 业务事务会因异常回滚，保证不会出现"资金已动但审计日志丢失"的不一致状态。
      await client.adminOperationLog.create({
        data: {
          adminId,
          action,
          target: target ?? null,
          detail: detail == null ? null : JSON.stringify(detail),
          ip,
          userAgent,
          hash,
          previousHash,
        },
      })
    }

    // 使用 PostgreSQL 事务级咨询锁串行化日志写入，防止并发 findFirst 读到相同
    // previousHash 导致哈希链分叉。pg_advisory_xact_lock 在事务提交/回滚时自动释放，
    // 因此即使 log() 在外部事务内调用，锁也会持有到外部事务提交，彻底消除竞态。
    // 咨询锁失败必须抛出异常：不降级为"直接写入"，否则并发写入会导致哈希链分叉，
    // 破坏审计链完整性。生产环境必须用 PostgreSQL。
    if (tx) {
      // 已在事务内：获取事务级咨询锁后写入
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(8831, 1)`
      await doLog(tx)
    } else {
      // 非事务调用：用短事务 + 咨询锁包裹读+写
      await this.prisma.$transaction(async (innerTx) => {
        await innerTx.$executeRaw`SELECT pg_advisory_xact_lock(8831, 1)`
        await doLog(innerTx)
      })
    }
  }

  /**
   * 校验日志链完整性
   *
   * 采用分页迭代全量扫描，避免一次性加载过多日志导致内存溢出。
   * H6: 按 seq 升序逐批校验（旧数据 seq 为 null 时回退 createdAt 排序，nulls first 让旧数据排在前面），
   * 保证校验顺序 = 写入顺序。每批默认 500 条。
   *
   * 返回第一条被篡改的日志 id，若全部通过则返回 null
   */
  async verifyChain(batchSize = 500): Promise<string | null> {
    let expectedPrevious = this.GENESIS_HASH
    let offset = 0

    // 分页迭代全量扫描哈希链
    while (true) {
      const logs = await this.prisma.adminOperationLog.findMany({
        orderBy: [{ seq: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
        skip: offset,
        take: batchSize,
      })

      if (logs.length === 0) {
        // 全部日志校验完成，未发现异常
        break
      }

      for (const log of logs) {
        // 校验 previousHash 链接
        if (log.previousHash !== expectedPrevious) {
          this.logger.warn(
            `日志链断裂：日志 ${log.id} 的 previousHash 不匹配`,
          )
          return log.id
        }
        // 校验内容哈希：从持久化字段重新计算并比对（与 doLog 保持一致，含 userAgent）
        const content = JSON.stringify({
          adminId: log.adminId,
          action: log.action,
          target: log.target,
          detail: log.detail,
          ip: log.ip,
          userAgent: log.userAgent,
          previousHash: log.previousHash,
        })
        const expectedHash = createHash('sha256').update(content).digest('hex')
        if (log.hash !== expectedHash) {
          this.logger.warn(
            `日志内容被篡改：日志 ${log.id} 的 hash 不匹配`,
          )
          return log.id
        }
        expectedPrevious = log.hash ?? this.GENESIS_HASH
      }

      offset += logs.length
    }

    return null
  }
}

