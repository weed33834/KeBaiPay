import { Test } from '@nestjs/testing'
import { ReconciliationService } from './reconciliation.service'
import { FinanceService } from './finance.service'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerType, ReconciliationStatus } from '../common/enums'

type PrismaMock = {
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  transactionOrder: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
  withdrawalOrder: Record<string, jest.Mock>
  dailySnapshot: Record<string, jest.Mock>
  reconciliationReport: Record<string, jest.Mock>
}

type FinanceServiceMock = { generateDailySnapshot: jest.Mock }

// groupBy 查询参数：仅当 where.type 存在表示是管理员调账查询
type GroupByArgs = {
  where?: { type?: unknown }
}

describe('ReconciliationService', () => {
  let service: ReconciliationService
  let prisma: PrismaMock
  let financeService: FinanceServiceMock

  beforeEach(async () => {
    prisma = {
      account: { aggregate: jest.fn() },
      accountLedger: { groupBy: jest.fn(), findMany: jest.fn() },
      transactionOrder: { findMany: jest.fn(), aggregate: jest.fn() },
      paymentOrder: { aggregate: jest.fn() },
      withdrawalOrder: { aggregate: jest.fn() },
      dailySnapshot: { findUnique: jest.fn() },
      reconciliationReport: { upsert: jest.fn() },
    }

    financeService = {
      generateDailySnapshot: jest.fn().mockResolvedValue(undefined),
    }

    const module = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceService, useValue: financeService },
      ],
    }).compile()

    service = module.get(ReconciliationService)
  })

  describe('runReconciliation 日终对账', () => {
    it('无昨日快照时只校验账簿净变动与交易完整性', async () => {
      // groupBy 第一次返回全部账本，第二次（带 type=ADJUSTMENT）返回空数组表示无调账
      prisma.accountLedger.groupBy.mockImplementation((args: GroupByArgs) => {
        if (args.where?.type === LedgerType.ADJUSTMENT) {
          return Promise.resolve([])
        }
        return Promise.resolve([
          { direction: 'DEBIT', _sum: { amount: 100000 } },
          { direction: 'CREDIT', _sum: { amount: 0 } },
        ])
      })
      prisma.account.aggregate.mockResolvedValue({ _sum: { totalBalance: 100000 } })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { fee: 0, amount: 0 } })
      prisma.withdrawalOrder.aggregate.mockResolvedValue({ _sum: { amount: 0, fee: 0 } })
      prisma.accountLedger.findMany.mockResolvedValue([])
      prisma.dailySnapshot.findUnique.mockResolvedValue(null)
      prisma.reconciliationReport.upsert.mockImplementation((args: unknown) => {
        const query = args as { create: Record<string, unknown> }
        return Promise.resolve({ ...query.create, id: 'r1' })
      })

      const result = await service.runReconciliation('2024-01-01')

      expect(result.status).toBe(ReconciliationStatus.SUCCESS)
      expect(result.summary.actualAssetsChange).toBe(100000)
      expect(result.summary.ledgerNetChange).toBe(100000)
      // 前一日快照缺失时会尝试调用 financeService 补生成
      expect(financeService.generateDailySnapshot).toHaveBeenCalledWith('2023-12-31')
    })

    it('资产变动与期望一致时对账成功', async () => {
      prisma.accountLedger.groupBy.mockImplementation((args: GroupByArgs) => {
        if (args.where?.type === LedgerType.ADJUSTMENT) {
          return Promise.resolve([])
        }
        return Promise.resolve([
          { direction: 'DEBIT', _sum: { amount: 20000 } },
          { direction: 'CREDIT', _sum: { amount: 10000 } },
        ])
      })
      prisma.account.aggregate.mockResolvedValue({ _sum: { totalBalance: 110000 } })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: 10000 } })
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { fee: 0, amount: 0 } })
      prisma.withdrawalOrder.aggregate.mockResolvedValue({ _sum: { amount: 0, fee: 0 } })
      prisma.accountLedger.findMany.mockResolvedValue([])
      prisma.dailySnapshot.findUnique.mockResolvedValue({ totalAssets: 100000 })
      prisma.reconciliationReport.upsert.mockImplementation((args: unknown) => {
        const query = args as { create: Record<string, unknown> }
        return Promise.resolve({ ...query.create, id: 'r1' })
      })

      const result = await service.runReconciliation('2024-01-02')

      expect(result.status).toBe(ReconciliationStatus.SUCCESS)
      expect(result.summary.actualAssetsChange).toBe(10000)
      expect(result.summary.expectedAssetsChange).toBe(10000)
      expect(result.summary.ledgerNetChange).toBe(10000)
      // 前一日快照存在时不应触发补生成
      expect(financeService.generateDailySnapshot).not.toHaveBeenCalled()
    })

    it('账簿净变动与资产变动不一致时标记失败', async () => {
      prisma.accountLedger.groupBy.mockImplementation((args: GroupByArgs) => {
        if (args.where?.type === LedgerType.ADJUSTMENT) {
          return Promise.resolve([])
        }
        return Promise.resolve([
          { direction: 'DEBIT', _sum: { amount: 0 } },
          { direction: 'CREDIT', _sum: { amount: 0 } },
        ])
      })
      prisma.account.aggregate.mockResolvedValue({ _sum: { totalBalance: 100000 } })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { fee: 0, amount: 0 } })
      prisma.withdrawalOrder.aggregate.mockResolvedValue({ _sum: { amount: 0, fee: 0 } })
      prisma.accountLedger.findMany.mockResolvedValue([])
      prisma.dailySnapshot.findUnique.mockResolvedValue(null)
      prisma.reconciliationReport.upsert.mockImplementation((args: unknown) => {
        const query = args as { create: Record<string, unknown> }
        return Promise.resolve({ ...query.create, id: 'r1' })
      })

      const result = await service.runReconciliation('2024-01-01')

      expect(result.status).toBe(ReconciliationStatus.FAILED)
      const diffs = JSON.parse(result.differences as string)
      expect(diffs).toContainEqual(
        expect.objectContaining({ check: 'ledger_balance' }),
      )
    })

    it('管理员调账净额计入期望资产变动，避免误报差异', async () => {
      // 场景：充值 10000，管理员调账 DEBIT 4000（加款），提现/手续费为 0
      // 全部账本：DEBIT 14000（充值+调账），CREDIT 0 → ledgerNetChange = 14000
      // 调账账本：DEBIT 4000，CREDIT 0 → adjustmentNet = 4000
      // totalAssets = 114000, prev = 100000 → actualAssetsChange = 14000
      // expectedAssetsChange = 10000 - 0 - 0 + 4000 = 14000（与实际一致，避免误报）
      prisma.accountLedger.groupBy.mockImplementation((args: GroupByArgs) => {
        if (args.where?.type === LedgerType.ADJUSTMENT) {
          return Promise.resolve([
            { direction: 'DEBIT', _sum: { amount: 4000 } },
            { direction: 'CREDIT', _sum: { amount: 0 } },
          ])
        }
        return Promise.resolve([
          { direction: 'DEBIT', _sum: { amount: 14000 } },
          { direction: 'CREDIT', _sum: { amount: 0 } },
        ])
      })
      prisma.account.aggregate.mockResolvedValue({ _sum: { totalBalance: 114000 } })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: 10000 } })
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { fee: 0, amount: 0 } })
      prisma.withdrawalOrder.aggregate.mockResolvedValue({ _sum: { amount: 0, fee: 0 } })
      prisma.accountLedger.findMany.mockResolvedValue([])
      prisma.dailySnapshot.findUnique.mockResolvedValue({ totalAssets: 100000 })
      prisma.reconciliationReport.upsert.mockImplementation((args: unknown) => {
        const query = args as { create: Record<string, unknown> }
        return Promise.resolve({ ...query.create, id: 'r1' })
      })

      const result = await service.runReconciliation('2024-01-03')

      // 期望变动包含调账净额后，与实际资产变动一致 → 对账成功，避免误报
      expect(result.summary.adjustmentNet).toBe(4000)
      expect(result.summary.expectedAssetsChange).toBe(14000)
      expect(result.summary.actualAssetsChange).toBe(14000)
      expect(result.status).toBe(ReconciliationStatus.SUCCESS)
    })

    it('快照补生成失败时标记为 SNAPSHOT_MISSING', async () => {
      prisma.accountLedger.groupBy.mockResolvedValue([
        { direction: 'DEBIT', _sum: { amount: 0 } },
        { direction: 'CREDIT', _sum: { amount: 0 } },
      ])
      prisma.account.aggregate.mockResolvedValue({ _sum: { totalBalance: 0 } })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { fee: 0, amount: 0 } })
      prisma.withdrawalOrder.aggregate.mockResolvedValue({ _sum: { amount: 0, fee: 0 } })
      prisma.accountLedger.findMany.mockResolvedValue([])
      prisma.dailySnapshot.findUnique.mockResolvedValue(null)
      financeService.generateDailySnapshot.mockRejectedValue(new Error('db error'))
      prisma.reconciliationReport.upsert.mockImplementation((args: unknown) => {
        const query = args as { create: Record<string, unknown> }
        return Promise.resolve({ ...query.create, id: 'r1' })
      })

      const result = await service.runReconciliation('2024-01-01')

      expect(result.status).toBe(ReconciliationStatus.SNAPSHOT_MISSING)
      const diffs = JSON.parse(result.differences as string)
      expect(diffs).toContainEqual(
        expect.objectContaining({ check: 'snapshot_missing' }),
      )
    })
  })
})
