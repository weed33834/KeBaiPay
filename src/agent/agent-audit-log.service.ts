import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  AGENT_GENESIS_HASH,
  AGENT_LOG_ADVISORY_LOCK_ID,
} from '../common/constants'

/**
 * Agent 操作审计日志（链式 hash 防篡改）
 *
 * 复用 AdminOperationLog 的设计模式：
 *  - 每条日志的 hash = sha256(JSON({agentId, action, scope, amount, detail, previousHash}))
 *  - previousHash 指向同 agent 的上一条日志（GENESIS_HASH 为全 0）
 *  - 使用 PG 咨询锁串行化写入，防止并发导致哈希链分叉
 *
 * 与 AuditLogService 的差异：日志按 Agent 维度组织，而非全局 seq。
 */
@Injectable()
export class AgentAuditLogService {
  private readonly logger = new Logger(AgentAuditLogService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入一条 Agent 操作日志
   * @param input 操作详情
   * @param tx 可选事务客户端，传入则在外部事务内执行
   */
  async log(
    input: {
      agentId: string
      subjectType: string
      subjectId: string
      action: string
      scope: string
      amount?: number | null
      result?: string
      detail?: Record<string, unknown> | null
    },
    tx?: any,
  ): Promise<{ id: string; hash: string }> {
    const doLog = async (client: any) => {
      // PG 事务级咨询锁，串行化同 Agent 的日志写入
      await client.$executeRaw`SELECT pg_advisory_xact_lock(${AGENT_LOG_ADVISORY_LOCK_ID}, ${input.agentId}::text::int % 32767)`

      // 取上一条日志的 hash
      const lastLog = await client.agentOperationLog.findFirst({
        where: { agentId: input.agentId },
        orderBy: [{ createdAt: 'desc' }],
        select: { hash: true },
      })
      const previousHash = lastLog?.hash || AGENT_GENESIS_HASH

      // 计算当前条目 hash
      const content = JSON.stringify({
        agentId: input.agentId,
        action: input.action,
        scope: input.scope,
        amount: input.amount ?? null,
        detail: input.detail ?? null,
        result: input.result ?? 'SUCCESS',
        previousHash,
      })
      const { createHash } = await import('crypto')
      const hash = createHash('sha256').update(content).digest('hex')

      const log = await client.agentOperationLog.create({
        data: {
          agentId: input.agentId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          action: input.action,
          scope: input.scope,
          amount: input.amount ?? null,
          result: input.result ?? 'SUCCESS',
          detail: input.detail ? JSON.stringify(input.detail) : null,
          hash,
          previousHash,
        },
      })
      return { id: log.id, hash: log.hash }
    }

    if (tx) return doLog(tx)
    return this.prisma.$transaction(doLog)
  }

  /**
   * 校验某 Agent 的哈希链完整性
   * 返回第一条断链位置的 id，全部通过返回 null
   */
  async verifyChain(agentId: string, batchSize = 500): Promise<string | null> {
    let cursor: string | undefined
    let previousHash = AGENT_GENESIS_HASH
    while (true) {
      const logs = await this.prisma.agentOperationLog.findMany({
        where: { agentId },
        orderBy: [{ createdAt: 'asc' }],
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          action: true,
          scope: true,
          amount: true,
          detail: true,
          result: true,
          hash: true,
          previousHash: true,
        },
      })
      if (logs.length === 0) break
      for (const log of logs) {
        if (log.previousHash !== previousHash) return log.id
        const { createHash } = await import('crypto')
        const content = JSON.stringify({
          agentId,
          action: log.action,
          scope: log.scope,
          amount: log.amount,
          detail: log.detail ? JSON.parse(log.detail) : null,
          result: log.result,
          previousHash: log.previousHash,
        })
        const expectedHash = createHash('sha256').update(content).digest('hex')
        if (expectedHash !== log.hash) return log.id
        previousHash = log.hash
        cursor = log.id
      }
      if (logs.length < batchSize) break
    }
    return null
  }
}
