import { Injectable, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { KBErrorCodes, kbError } from '../common/error-codes'

export interface JournalEntryInput {
  journalId: string
  accountCode: string  // 平台账户code 或 "USER:{userId}"
  debit?: number
  credit?: number
  memo?: string
}

@Injectable()
export class JournalService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // 应用启动时初始化默认平台账户
    await this.seedPlatformAccounts()
  }

  // 在事务内创建一组借贷平衡的分录
  // 校验 sum(debit) === sum(credit)，否则抛错
  // 同事务维护 PlatformAccount.balance：按 accountCode 分组，debit 加余额、credit 减余额
  async createEntries(
    tx: Prisma.TransactionClient,
    entries: JournalEntryInput[],
  ): Promise<void> {
    const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0)
    const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0)
    if (totalDebit !== totalCredit) {
      throw new Error(kbError(KBErrorCodes.JOURNAL_UNBALANCED, `借贷不平衡: debit=${totalDebit}, credit=${totalCredit}`))
    }
    await tx.journalEntry.createMany({
      data: entries.map((e) => ({
        journalId: e.journalId,
        accountCode: e.accountCode,
        debit: e.debit || 0,
        credit: e.credit || 0,
        memo: e.memo,
      })),
    })

    // 按账户分组聚合净额，仅平台账户（非 "USER:xxx"）更新 PlatformAccount.balance
    // debit 加余额、credit 减余额；"USER:xxx" 为用户账户挂账，不对应 PlatformAccount
    const platformDelta = new Map<string, number>()
    for (const e of entries) {
      if (e.accountCode.startsWith('USER:')) continue
      const delta = (e.debit || 0) - (e.credit || 0)
      platformDelta.set(e.accountCode, (platformDelta.get(e.accountCode) || 0) + delta)
    }
    for (const [code, delta] of platformDelta) {
      if (delta === 0) continue
      await tx.platformAccount.update({
        where: { code },
        data: { balance: { increment: delta } },
      })
    }
  }

  // 查询平台账户余额
  async getPlatformAccountBalance(code: string): Promise<number> {
    const account = await this.prisma.platformAccount.findUnique({
      where: { code },
    })
    return account?.balance || 0
  }

  // 初始化默认平台账户（应用启动时调用）
  async seedPlatformAccounts(): Promise<void> {
    const defaults = [
      { code: 'REVENUE_FEE', name: '手续费收入' },
      { code: 'CHANNEL_FUND', name: '渠道资金' },
      { code: 'MERCHANT_PAYABLE', name: '应付商户款' },
    ]
    for (const d of defaults) {
      await this.prisma.platformAccount.upsert({
        where: { code: d.code },
        create: d,
        update: {},
      })
    }
  }
}
