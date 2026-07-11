import { Prisma } from '@prisma/client'
import { JournalService, type JournalEntryInput } from './journal.service'
import { PrismaService } from '../prisma/prisma.service'

type PrismaMock = {
  platformAccount: { findUnique: jest.Mock; upsert: jest.Mock }
}
type TxMock = {
  journalEntry: { createMany: jest.Mock }
  platformAccount: { update: jest.Mock }
}

describe('JournalService', () => {
  let service: JournalService
  let prisma: PrismaMock
  let tx: TxMock

  beforeEach(() => {
    prisma = {
      platformAccount: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
    }
    tx = {
      journalEntry: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      // M9：createEntries 同事务按 accountCode 更新 PlatformAccount.balance
      platformAccount: { update: jest.fn().mockResolvedValue({}) },
    }
    // 直接 new 避免 onModuleInit 自动触发 seedPlatformAccounts
    service = new JournalService(prisma as unknown as PrismaService)
  })

  describe('createEntries 复式记账', () => {
    it('借贷平衡时正常创建分录', async () => {
      const entries: JournalEntryInput[] = [
        { journalId: 'j1', accountCode: 'USER:u1', debit: 10000, memo: '借方' },
        { journalId: 'j1', accountCode: 'REVENUE_FEE', credit: 10000, memo: '贷方' },
      ]

      await service.createEntries(
        tx as unknown as Prisma.TransactionClient,
        entries,
      )

      expect(tx.journalEntry.createMany).toHaveBeenCalledWith({
        data: [
          { journalId: 'j1', accountCode: 'USER:u1', debit: 10000, credit: 0, memo: '借方' },
          { journalId: 'j1', accountCode: 'REVENUE_FEE', debit: 0, credit: 10000, memo: '贷方' },
        ],
      })
      // M9：仅平台账户 REVENUE_FEE 更新余额（credit 减余额），USER:u1 不对应 PlatformAccount
      expect(tx.platformAccount.update).toHaveBeenCalledTimes(1)
      expect(tx.platformAccount.update).toHaveBeenCalledWith({
        where: { code: 'REVENUE_FEE' },
        data: { balance: { increment: -10000 } },
      })
    })

    it('借贷不平衡(借 > 贷)时抛错', async () => {
      const entries: JournalEntryInput[] = [
        { journalId: 'j1', accountCode: 'USER:u1', debit: 10000 },
        { journalId: 'j1', accountCode: 'REVENUE_FEE', credit: 5000 },
      ]

      await expect(
        service.createEntries(tx as unknown as Prisma.TransactionClient, entries),
      ).rejects.toThrow(/借贷不平衡/)
      expect(tx.journalEntry.createMany).not.toHaveBeenCalled()
    })

    it('借贷不平衡(贷 > 借)时抛错', async () => {
      const entries: JournalEntryInput[] = [
        { journalId: 'j1', accountCode: 'USER:u1', debit: 3000 },
        { journalId: 'j1', accountCode: 'REVENUE_FEE', credit: 5000 },
      ]

      await expect(
        service.createEntries(tx as unknown as Prisma.TransactionClient, entries),
      ).rejects.toThrow(/借贷不平衡/)
      expect(tx.journalEntry.createMany).not.toHaveBeenCalled()
    })

    it('createEntries 使用传入的 tx 客户端而非 prisma', async () => {
      const entries: JournalEntryInput[] = [
        { journalId: 'j1', accountCode: 'USER:u1', debit: 100 },
        { journalId: 'j1', accountCode: 'REVENUE_FEE', credit: 100 },
      ]

      await service.createEntries(
        tx as unknown as Prisma.TransactionClient,
        entries,
      )

      // 验证调用的是 tx 上的 journalEntry.createMany
      expect(tx.journalEntry.createMany).toHaveBeenCalledTimes(1)
      // prisma 上没有 journalEntry 字段，不会被调用
      expect((prisma as Record<string, unknown>).journalEntry).toBeUndefined()
      // M9：PlatformAccount 更新也走同一 tx（USER:u1 跳过，仅 REVENUE_FEE 更新）
      expect(tx.platformAccount.update).toHaveBeenCalledTimes(1)
    })

    it('空分录数组(0=0)平衡，调用 createMany 传入空数组', async () => {
      await service.createEntries(tx as unknown as Prisma.TransactionClient, [])

      expect(tx.journalEntry.createMany).toHaveBeenCalledWith({ data: [] })
    })

    it('仅含借方和仅含贷方的分录在总额相等时平衡', async () => {
      const entries: JournalEntryInput[] = [
        { journalId: 'j1', accountCode: 'USER:u1', debit: 5000 },
        { journalId: 'j1', accountCode: 'USER:u2', debit: 5000 },
        { journalId: 'j1', accountCode: 'CHANNEL_FUND', credit: 10000 },
      ]

      await service.createEntries(tx as unknown as Prisma.TransactionClient, entries)

      expect(tx.journalEntry.createMany).toHaveBeenCalledWith({
        data: [
          { journalId: 'j1', accountCode: 'USER:u1', debit: 5000, credit: 0, memo: undefined },
          { journalId: 'j1', accountCode: 'USER:u2', debit: 5000, credit: 0, memo: undefined },
          { journalId: 'j1', accountCode: 'CHANNEL_FUND', debit: 0, credit: 10000, memo: undefined },
        ],
      })
      // M9：仅 CHANNEL_FUND 是平台账户，两个 USER: 账户跳过
      expect(tx.platformAccount.update).toHaveBeenCalledTimes(1)
      expect(tx.platformAccount.update).toHaveBeenCalledWith({
        where: { code: 'CHANNEL_FUND' },
        data: { balance: { increment: -10000 } },
      })
    })

    it('未提供 debit/credit 时默认为 0', async () => {
      const entries: JournalEntryInput[] = [
        { journalId: 'j1', accountCode: 'A', credit: 100 },
        { journalId: 'j1', accountCode: 'B', debit: 100 },
      ]

      await service.createEntries(tx as unknown as Prisma.TransactionClient, entries)

      const callData = tx.journalEntry.createMany.mock.calls[0][0].data as Array<{
        debit: number
        credit: number
      }>
      // 未提供 debit 的条目默认 0，未提供 credit 的条目默认 0
      expect(callData[0].debit).toBe(0)
      expect(callData[0].credit).toBe(100)
      expect(callData[1].debit).toBe(100)
      expect(callData[1].credit).toBe(0)
      // M9：两个非 USER 平台账户各更新一次（A: credit 减余额，B: debit 加余额）
      expect(tx.platformAccount.update).toHaveBeenCalledTimes(2)
      expect(tx.platformAccount.update).toHaveBeenCalledWith({
        where: { code: 'A' },
        data: { balance: { increment: -100 } },
      })
      expect(tx.platformAccount.update).toHaveBeenCalledWith({
        where: { code: 'B' },
        data: { balance: { increment: 100 } },
      })
    })
  })

  describe('getPlatformAccountBalance 平台账户余额', () => {
    it('返回平台账户余额', async () => {
      prisma.platformAccount.findUnique.mockResolvedValue({
        id: 'p1',
        code: 'REVENUE_FEE',
        name: '手续费收入',
        balance: 500000,
      })

      const balance = await service.getPlatformAccountBalance('REVENUE_FEE')

      expect(balance).toBe(500000)
      expect(prisma.platformAccount.findUnique).toHaveBeenCalledWith({
        where: { code: 'REVENUE_FEE' },
      })
    })

    it('账户不存在时返回 0', async () => {
      prisma.platformAccount.findUnique.mockResolvedValue(null)

      const balance = await service.getPlatformAccountBalance('NOT_EXIST')

      expect(balance).toBe(0)
    })
  })

  describe('seedPlatformAccounts 初始化默认账户', () => {
    it('upsert 三个默认平台账户', async () => {
      await service.seedPlatformAccounts()

      expect(prisma.platformAccount.upsert).toHaveBeenCalledTimes(3)
      expect(prisma.platformAccount.upsert).toHaveBeenCalledWith({
        where: { code: 'REVENUE_FEE' },
        create: { code: 'REVENUE_FEE', name: '手续费收入' },
        update: {},
      })
      expect(prisma.platformAccount.upsert).toHaveBeenCalledWith({
        where: { code: 'CHANNEL_FUND' },
        create: { code: 'CHANNEL_FUND', name: '渠道资金' },
        update: {},
      })
      expect(prisma.platformAccount.upsert).toHaveBeenCalledWith({
        where: { code: 'MERCHANT_PAYABLE' },
        create: { code: 'MERCHANT_PAYABLE', name: '应付商户款' },
        update: {},
      })
    })
  })

  describe('onModuleInit', () => {
    it('启动时调用 seedPlatformAccounts', async () => {
      await service.onModuleInit()

      expect(prisma.platformAccount.upsert).toHaveBeenCalledTimes(3)
    })
  })
})
