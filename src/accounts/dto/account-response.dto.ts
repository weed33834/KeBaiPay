import { Prisma } from '@prisma/client'

export type AccountWithLedgers = Prisma.AccountGetPayload<{
  include: { ledgers: true }
}>

export type AccountLedgerItem = AccountWithLedgers['ledgers'][number]
