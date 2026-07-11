import { Test } from '@nestjs/testing'
import { AccountsService } from './accounts.service'
import { PrismaService } from '../prisma/prisma.service'
import { fenToYuan } from '../common/helpers'

type LedgerRow = {
  id: string
  amount: number
  type: string
  createdAt: Date
}

type AccountRow = {
  id: string
  userId: string
  availableBalance: number
  totalBalance: number
  frozenBalance: number
  status: string
  ledgers: LedgerRow[]
}

type PrismaMock = {
  account: { findUnique: jest.Mock }
}

describe('AccountsService', () => {
  let service: AccountsService
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = {
      account: { findUnique: jest.fn() },
    }
    const module = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()
    service = module.get(AccountsService)
  })

  const buildAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
    id: 'a1',
    userId: 'u1',
    availableBalance: 10000,
    totalBalance: 10000,
    frozenBalance: 0,
    status: 'ACTIVE',
    ledgers: Array.from({ length: 20 }, (_, i) => ({
      id: `l${i}`,
      amount: 100,
      type: 'RECHARGE',
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    })),
    ...overrides,
  })

  describe('findByUserId', () => {
    it('返回账户及最近 20 条流水，并按 createdAt desc 查询', async () => {
      const account = buildAccount()
      prisma.account.findUnique.mockResolvedValue(account)

      const result = await service.findByUserId('u1')

      // 验证返回值的具体字段，而非把 mock 原样回显
      expect(result).not.toBeNull()
      expect(result?.id).toBe('a1')
      expect(result?.userId).toBe('u1')
      expect(result?.availableBalance).toBe(10000)
      expect(result?.totalBalance).toBe(10000)
      expect(result?.ledgers).toHaveLength(20)
      expect(result?.ledgers[0].id).toBe('l0')
      // 验证查询参数：透传 userId、按 createdAt 倒序、限制 20 条
      expect(prisma.account.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        include: { ledgers: { orderBy: { createdAt: 'desc' }, take: 20 } },
      })
    })

    it('返回值是 prisma 结果的透传（同引用，未做克隆或转换）', async () => {
      const account = buildAccount()
      prisma.account.findUnique.mockResolvedValue(account)

      const result = await service.findByUserId('u1')

      expect(result).toBe(account)
    })

    it('账户不存在时返回 null', async () => {
      prisma.account.findUnique.mockResolvedValue(null)

      const result = await service.findByUserId('u-not-exist')

      expect(result).toBeNull()
      expect(prisma.account.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u-not-exist' },
        include: { ledgers: { orderBy: { createdAt: 'desc' }, take: 20 } },
      })
    })

    it('账户存在但无流水时 ledgers 为空数组（非 undefined）', async () => {
      const account = buildAccount({ ledgers: [] })
      prisma.account.findUnique.mockResolvedValue(account)

      const result = await service.findByUserId('u1')

      expect(result).not.toBeNull()
      expect(result?.ledgers).toEqual([])
      expect(result?.ledgers).toHaveLength(0)
    })

    it('include.ledgers.take 固定为 20，防止全表扫描', async () => {
      prisma.account.findUnique.mockResolvedValue(null)
      await service.findByUserId('u1')

      const args = prisma.account.findUnique.mock.calls[0][0] as {
        include: { ledgers: { orderBy: { createdAt: string }; take: number } }
      }
      expect(args.include.ledgers.take).toBe(20)
      expect(args.include.ledgers.orderBy).toEqual({ createdAt: 'desc' })
    })

    it('将不同 userId 正确透传到 where 条件', async () => {
      prisma.account.findUnique.mockResolvedValue(null)
      await service.findByUserId('user-xyz-789')

      const args = prisma.account.findUnique.mock.calls[0][0] as {
        where: { userId: string }
      }
      expect(args.where).toEqual({ userId: 'user-xyz-789' })
    })

    it('prisma 抛错时向上传播（不吞错）', async () => {
      const error = new Error('DB connection lost')
      prisma.account.findUnique.mockRejectedValue(error)

      await expect(service.findByUserId('u1')).rejects.toThrow('DB connection lost')
    })

    it('返回的账户包含 frozenBalance 等全部字段（含异常状态）', async () => {
      const account = buildAccount({
        frozenBalance: 500,
        totalBalance: 10500,
        availableBalance: 10000,
        status: 'FROZEN',
      })
      prisma.account.findUnique.mockResolvedValue(account)

      const result = await service.findByUserId('u1')

      expect(result?.frozenBalance).toBe(500)
      expect(result?.totalBalance).toBe(10500)
      expect(result?.status).toBe('FROZEN')
    })
  })

  describe('fenToYuan 金额格式化', () => {
    it('0 分 → "0.00"', () => {
      expect(fenToYuan(0)).toBe('0.00')
    })

    it('100 分 → "1.00"', () => {
      expect(fenToYuan(100)).toBe('1.00')
    })

    it('1 分 → "0.01"（最小单位）', () => {
      expect(fenToYuan(1)).toBe('0.01')
    })

    it('12345 分 → "123.45"（普通金额）', () => {
      expect(fenToYuan(12345)).toBe('123.45')
    })

    it('负数分 → 负数元字符串（fenToYuan 不拦截负数）', () => {
      expect(fenToYuan(-100)).toBe('-1.00')
      expect(fenToYuan(-1)).toBe('-0.01')
    })

    it('大额分 → 正确元值（不产生科学计数法）', () => {
      expect(fenToYuan(999999999)).toBe('9999999.99')
    })
  })
})
