import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { AuditLogService } from './audit-log.service'
import { PrismaService } from '../prisma/prisma.service'

const GENESIS_HASH = '0'.repeat(64)

type AdminOperationLogMock = {
  findFirst: jest.Mock
  create: jest.Mock
  findMany: jest.Mock
}
type PrismaMock = {
  adminOperationLog: AdminOperationLogMock
  $transaction: jest.Mock
}
type TxClientMock = {
  $executeRaw: jest.Mock
  adminOperationLog: AdminOperationLogMock
}

/**
 * 复刻服务中的 hash 计算逻辑，用于在测试中生成正确哈希以构造完整链条
 */
function computeHash(fields: {
  adminId: string
  action: string
  target: string | null
  detail: string | null
  ip: string | null
  previousHash: string
}): string {
  const content = JSON.stringify({
    adminId: fields.adminId,
    action: fields.action,
    target: fields.target,
    detail: fields.detail,
    ip: fields.ip,
    previousHash: fields.previousHash,
  })
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 构造一条完整的审计日志记录（含正确 hash），用于 verifyChain 测试
 */
function makeLogEntry(opts: {
  id: string
  adminId: string
  action: string
  target?: string | null
  detail?: unknown
  ip?: string | null
  previousHash: string
  createdAt: Date
}): {
  id: string
  adminId: string
  action: string
  target: string | null
  detail: string | null
  ip: string | null
  userAgent: string | null
  hash: string
  previousHash: string
  createdAt: Date
} {
  const target = opts.target ?? null
  const detail = opts.detail == null ? null : JSON.stringify(opts.detail)
  const ip = opts.ip ?? null
  const hash = computeHash({
    adminId: opts.adminId,
    action: opts.action,
    target,
    detail,
    ip,
    previousHash: opts.previousHash,
  })
  return {
    id: opts.id,
    adminId: opts.adminId,
    action: opts.action,
    target,
    detail,
    ip,
    userAgent: null,
    hash,
    previousHash: opts.previousHash,
    createdAt: opts.createdAt,
  }
}

describe('AuditLogService', () => {
  let service: AuditLogService
  let prisma: PrismaMock
  let innerTx: TxClientMock

  beforeEach(() => {
    prisma = {
      adminOperationLog: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    }
    innerTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      adminOperationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    // 默认：$transaction 调用回调并传入 innerTx
    prisma.$transaction.mockImplementation(async (cb: (tx: TxClientMock) => Promise<unknown>) =>
      cb(innerTx),
    )
    service = new AuditLogService(prisma as unknown as PrismaService)
  })

  describe('log 写入哈希链', () => {
    it('首条记录的 previousHash 为创世哈希(全零)', async () => {
      innerTx.adminOperationLog.findFirst.mockResolvedValue(null)

      await service.log({ adminId: 'admin1', action: 'ACCOUNT_ADJUST' })

      expect(innerTx.adminOperationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId: 'admin1',
          action: 'ACCOUNT_ADJUST',
          previousHash: GENESIS_HASH,
          hash: expect.any(String),
        }),
      })
    })

    it('第二条记录的 previousHash 为上一条记录的 hash', async () => {
      innerTx.adminOperationLog.findFirst.mockResolvedValue({ hash: 'prev-hash-abc' })

      await service.log({ adminId: 'admin1', action: 'USER_STATUS_UPDATE' })

      expect(innerTx.adminOperationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousHash: 'prev-hash-abc',
        }),
      })
    })

    it('hash 为 SHA256(adminId+action+target+detail+ip+previousHash) 的正确值', async () => {
      innerTx.adminOperationLog.findFirst.mockResolvedValue(null)

      await service.log({
        adminId: 'admin1',
        action: 'ACCOUNT_ADJUST',
        target: 'u1',
        detail: { amount: 1000, reason: '补偿' },
        ip: '1.2.3.4',
      })

      const createCall = innerTx.adminOperationLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      const expectedHash = computeHash({
        adminId: 'admin1',
        action: 'ACCOUNT_ADJUST',
        target: 'u1',
        detail: JSON.stringify({ amount: 1000, reason: '补偿' }),
        ip: '1.2.3.4',
        previousHash: GENESIS_HASH,
      })
      expect(createCall.data.hash).toBe(expectedHash)
    })

    it('无 tx 参数时使用 prisma.$transaction 包裹写入', async () => {
      await service.log({ adminId: 'admin1', action: 'ACT' })

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      // 在 $transaction 回调内获取了咨询锁并写入
      expect(innerTx.$executeRaw).toHaveBeenCalled()
      expect(innerTx.adminOperationLog.create).toHaveBeenCalled()
    })

    it('传入 tx 参数时使用 tx 直接写入(不调用 prisma.$transaction)', async () => {
      const tx: TxClientMock = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        adminOperationLog: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          findMany: jest.fn(),
        },
      }

      await service.log(
        { adminId: 'admin1', action: 'ACT' },
        tx as unknown as Prisma.TransactionClient,
      )

      expect(tx.$executeRaw).toHaveBeenCalled()
      expect(tx.adminOperationLog.create).toHaveBeenCalled()
      // 不应调用 prisma.$transaction
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('create 写入失败时不抛错(降级不阻塞业务)', async () => {
      innerTx.adminOperationLog.create.mockRejectedValue(new Error('DB write failed'))

      // 不应抛出异常
      await expect(
        service.log({ adminId: 'admin1', action: 'ACT' }),
      ).resolves.toBeUndefined()
    })

    it('咨询锁失败时降级为直接写入(prisma)', async () => {
      // $transaction 抛错模拟咨询锁不可用
      prisma.$transaction.mockRejectedValue(new Error('advisory lock unavailable'))
      prisma.adminOperationLog.findFirst.mockResolvedValue(null)
      prisma.adminOperationLog.create.mockResolvedValue({})

      await service.log({ adminId: 'admin1', action: 'ACT' })

      // 降级后使用 prisma 直接写入
      expect(prisma.adminOperationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId: 'admin1',
          previousHash: GENESIS_HASH,
        }),
      })
    })
  })

  describe('verifyChain 链完整性校验', () => {
    it('完整链条返回 null', async () => {
      const log1 = makeLogEntry({
        id: 'l1',
        adminId: 'a1',
        action: 'ACT1',
        previousHash: GENESIS_HASH,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })
      const log2 = makeLogEntry({
        id: 'l2',
        adminId: 'a1',
        action: 'ACT2',
        target: 'u1',
        previousHash: log1.hash,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      })
      const log3 = makeLogEntry({
        id: 'l3',
        adminId: 'a2',
        action: 'ACT3',
        detail: { key: 'val' },
        ip: '1.2.3.4',
        previousHash: log2.hash,
        createdAt: new Date('2026-01-03T00:00:00Z'),
      })
      // 使用 mockResolvedValueOnce 确保分页第二次调用返回空数组以终止迭代
      prisma.adminOperationLog.findMany
        .mockResolvedValueOnce([log1, log2, log3])
        .mockResolvedValueOnce([])

      const result = await service.verifyChain()

      expect(result).toBeNull()
    })

    it('检测到中间记录 hash 被篡改时返回该记录 id', async () => {
      const log1 = makeLogEntry({
        id: 'l1',
        adminId: 'a1',
        action: 'ACT1',
        previousHash: GENESIS_HASH,
        createdAt: new Date('2026-01-01'),
      })
      const log2 = makeLogEntry({
        id: 'l2',
        adminId: 'a1',
        action: 'ACT2',
        previousHash: log1.hash,
        createdAt: new Date('2026-01-02'),
      })
      // 篡改 log2 的 hash
      const tamperedLog2 = { ...log2, hash: 'tampered-hash-value' }
      const log3 = makeLogEntry({
        id: 'l3',
        adminId: 'a2',
        action: 'ACT3',
        previousHash: log2.hash,
        createdAt: new Date('2026-01-03'),
      })

      prisma.adminOperationLog.findMany.mockResolvedValue([log1, tamperedLog2, log3])

      const result = await service.verifyChain()

      expect(result).toBe('l2')
    })

    it('检测到 previousHash 链接断裂时返回该记录 id', async () => {
      const log1 = makeLogEntry({
        id: 'l1',
        adminId: 'a1',
        action: 'ACT1',
        previousHash: GENESIS_HASH,
        createdAt: new Date('2026-01-01'),
      })
      // log2 的 previousHash 与 log1.hash 不匹配
      const log2 = makeLogEntry({
        id: 'l2',
        adminId: 'a1',
        action: 'ACT2',
        previousHash: 'wrong-previous-hash',
        createdAt: new Date('2026-01-02'),
      })

      prisma.adminOperationLog.findMany.mockResolvedValue([log1, log2])

      const result = await service.verifyChain()

      expect(result).toBe('l2')
    })

    it('检测到内容被篡改(action 变更)时返回该记录 id', async () => {
      const log1 = makeLogEntry({
        id: 'l1',
        adminId: 'a1',
        action: 'ACT1',
        previousHash: GENESIS_HASH,
        createdAt: new Date('2026-01-01'),
      })
      // log2 的 hash 是用 action='ACT2' 计算的，但持久化的 action 被篡改为 'TAMPERED'
      const log2 = makeLogEntry({
        id: 'l2',
        adminId: 'a1',
        action: 'ACT2',
        previousHash: log1.hash,
        createdAt: new Date('2026-01-02'),
      })
      const tamperedContentLog2 = { ...log2, action: 'TAMPERED' }

      prisma.adminOperationLog.findMany.mockResolvedValue([log1, tamperedContentLog2])

      const result = await service.verifyChain()

      expect(result).toBe('l2')
    })

    it('空日志链返回 null', async () => {
      prisma.adminOperationLog.findMany.mockResolvedValue([])

      const result = await service.verifyChain()

      expect(result).toBeNull()
    })

    it('分页迭代: 多批日志全部校验通过', async () => {
      const log1 = makeLogEntry({
        id: 'l1',
        adminId: 'a1',
        action: 'ACT1',
        previousHash: GENESIS_HASH,
        createdAt: new Date('2026-01-01'),
      })
      const log2 = makeLogEntry({
        id: 'l2',
        adminId: 'a1',
        action: 'ACT2',
        previousHash: log1.hash,
        createdAt: new Date('2026-01-02'),
      })
      const log3 = makeLogEntry({
        id: 'l3',
        adminId: 'a2',
        action: 'ACT3',
        previousHash: log2.hash,
        createdAt: new Date('2026-01-03'),
      })

      // batchSize=2: 第一批 [log1, log2]，第二批 [log3]，第三批 []
      prisma.adminOperationLog.findMany
        .mockResolvedValueOnce([log1, log2])
        .mockResolvedValueOnce([log3])
        .mockResolvedValueOnce([])

      const result = await service.verifyChain(2)

      expect(result).toBeNull()
      expect(prisma.adminOperationLog.findMany).toHaveBeenCalledTimes(3)
    })
  })
})
