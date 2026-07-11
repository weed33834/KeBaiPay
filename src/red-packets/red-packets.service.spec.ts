import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { RedPacketsService } from './red-packets.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction' | 'recordTransactionFrequency', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  redPacket: Record<string, jest.Mock>
  redPacketRecord: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
} & Record<string, unknown>

type FindUniqueArgs = { where: { id?: string; userId?: string } }
type CreateArgs = { data: Record<string, unknown> }
type UpdateArgs = { where: { id?: string }; data: Record<string, unknown> }

describe('RedPacketsService', () => {
  let service: RedPacketsService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let riskEngine: RiskEngineMock

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      redPacket: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
      // M4：receive 在事务内先查 RedPacketRecord 幂等返回，默认无已领取记录
      // 注意：实现使用 findFirst 做幂等检查，spec mock 同步
      redPacketRecord: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn(),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
      recordTransactionFrequency: jest.fn().mockResolvedValue(undefined),
    }

    const module = await Test.createTestingModule({
      providers: [
        RedPacketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
      ],
    }).compile()

    service = module.get(RedPacketsService)
  })

  const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    ...overrides,
  })

  describe('create 发红包', () => {
    it('金额小于等于 0 报错', async () => {
      await expect(
        service.create('u1', { amount: 0, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('未实名不能发红包', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ realNameStatus: 'PENDING' }))
      await expect(
        service.create('u1', { amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('余额不足报错', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 100, // 1 元
        frozenBalance: 0,
      })
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.create('u1', { amount: 50, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('发送方 FROZEN 禁止发红包', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ status: 'FROZEN' }))
      await expect(
        service.create('u1', { amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('发送方 EXPENSE_RESTRICTED 禁止发红包', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ status: 'EXPENSE_RESTRICTED' }))
      await expect(
        service.create('u1', { amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('正常发红包：冻结余额、24 小时过期', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 10000,
          frozenBalance: 0,
        })
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 9000,
          frozenBalance: 1000,
        })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      const now = Date.now()
      prisma.redPacket.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'rp1', ...query.data })
      })

      const packet = await service.create('u1', { amount: 10, payPassword: '123456', remark: '恭喜' })
      expect(packet.status).toBe('PENDING')
      expect(packet.amount).toBe(1000) // 10 元
      // 过期时间约 24 小时后
      const expiresAt = new Date(packet.expiresAt).getTime()
      expect(expiresAt).toBeGreaterThan(now + 23 * 60 * 60 * 1000)
      expect(expiresAt).toBeLessThan(now + 25 * 60 * 60 * 1000)
      // 冻结余额
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', availableBalance: { gte: 1000 } },
          data: {
            availableBalance: { decrement: 1000 },
            frozenBalance: { increment: 1000 },
          },
        }),
      )
    })
  })

  describe('receive 领红包', () => {
    it('红包不存在报错', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ id: 'u2', nickname: '李四' }))
      prisma.redPacket.findUnique.mockResolvedValue(null)
      await expect(service.receive('u2', 'RP999')).rejects.toThrow(NotFoundException)
    })

    it('不能领自己的红包', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      prisma.redPacket.findUnique.mockResolvedValue({
        id: 'rp1',
        packetNo: 'RP1',
        senderId: 'u1',
        amount: 1000,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
        sender: verifiedUser(),
      })
      await expect(service.receive('u1', 'RP1')).rejects.toThrow(BadRequestException)
    })

    it('已领取的红包不能再领', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ id: 'u2', nickname: '李四' }))
      prisma.redPacket.findUnique.mockResolvedValue({
        id: 'rp1',
        packetNo: 'RP1',
        senderId: 'u1',
        amount: 1000,
        status: 'RECEIVED',
        expiresAt: new Date(Date.now() + 60000),
        sender: verifiedUser(),
      })
      await expect(service.receive('u2', 'RP1')).rejects.toThrow(BadRequestException)
    })

    it('本人重复领取(已存在领取记录)幂等返回，不重复入账', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ id: 'u2', nickname: '李四' }))
      prisma.redPacket.findUnique.mockResolvedValue({
        id: 'rp1',
        packetNo: 'RP1',
        senderId: 'u1',
        amount: 1000,
        status: 'RECEIVED',
        expiresAt: new Date(Date.now() + 60000),
        sender: verifiedUser(),
      })
      const existingRecord = {
        id: 'rpr1',
        redPacketId: 'rp1',
        receiverId: 'u2',
        amount: 1000,
        type: 'RECEIVE',
      }
      // M4：事务内查到已存在领取记录，直接幂等返回（实现使用 findFirst）
      prisma.redPacketRecord.findFirst.mockResolvedValue(existingRecord)

      const result = await service.receive('u2', 'RP1', 'idem-1')
      expect(result).toBe(existingRecord)
      // 幂等返回不应再创建领取记录、不应再改账户余额
      expect(prisma.redPacketRecord.create).not.toHaveBeenCalled()
      expect(prisma.account.update).not.toHaveBeenCalled()
      expect(prisma.redPacket.updateMany).not.toHaveBeenCalled()
    })

    it('接收方 FROZEN 禁止领取', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ id: 'u2', nickname: '李四', status: 'FROZEN' }))
      await expect(service.receive('u2', 'RP1')).rejects.toThrow(ForbiddenException)
    })

    it('接收方 INCOME_RESTRICTED 禁止领取', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ id: 'u2', nickname: '李四', status: 'INCOME_RESTRICTED' }))
      await expect(service.receive('u2', 'RP1')).rejects.toThrow(ForbiddenException)
    })

    it('正常领取：收款方余额增加、发红包方冻结释放', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ id: 'u2', nickname: '李四' }))
      prisma.redPacket.findUnique.mockResolvedValue({
        id: 'rp1',
        packetNo: 'RP1',
        senderId: 'u1',
        amount: 1000,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
        sender: verifiedUser({ id: 'u1', nickname: '张三' }),
      })
      prisma.redPacket.update.mockResolvedValue({ id: 'rp1', status: 'RECEIVED' })
      // 乐观锁：updateMany 返回命中 1 条表示领取成功
      prisma.redPacket.updateMany.mockResolvedValue({ count: 1 })
      // 收款方账户
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as FindUniqueArgs
        if (query.where.userId === 'u2' || query.where.id === 'a2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 5000, totalBalance: 5000 })
        if (query.where.userId === 'u1' || query.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 0, frozenBalance: 1000, totalBalance: 1000 })
        return Promise.resolve(null)
      })
      prisma.account.update.mockImplementation((args: unknown) => {
        const query = args as UpdateArgs
        if (query.where.id === 'a2') return Promise.resolve({ availableBalance: 6000, totalBalance: 6000 })
        return Promise.resolve({ frozenBalance: 0, totalBalance: 0 })
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.receive('u2', 'RP1')
      // M4 后 receive 返回类型为 RedPacketRecord | 红包对象，正常领取路径返回带 status 的红包对象
      expect((result as { status: string }).status).toBe('RECEIVED')
      // 收款方余额增加
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a2' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 发红包方冻结释放
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', frozenBalance: { gte: 1000 } },
          data: {
            frozenBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      // 双方账单
      expect(prisma.bill.create).toHaveBeenCalledTimes(2)
    })
  })

  describe('expireReturn 过期退回', () => {
    it('红包不存在报错', async () => {
      prisma.redPacket.findUnique.mockResolvedValue(null)
      await expect(service.expireReturn('rp999')).rejects.toThrow(NotFoundException)
    })

    it('已领取的红包不退回', async () => {
      prisma.redPacket.findUnique.mockResolvedValue({
        id: 'rp1',
        status: 'RECEIVED',
        senderId: 'u1',
        amount: 1000,
      })
      const result = await service.expireReturn('rp1')
      // 直接返回，不执行退回逻辑
      expect(result!.status).toBe('RECEIVED')
      expect(prisma.redPacket.update).not.toHaveBeenCalled()
    })

    it('待领取红包过期退回：冻结释放、生成退回账单', async () => {
      // expireReturn 第一次查询返回 PENDING，returnPacket 内部第二次查询返回 EXPIRED
      prisma.redPacket.findUnique
        .mockResolvedValueOnce({
          id: 'rp1',
          status: 'PENDING',
          senderId: 'u1',
          amount: 1000,
        })
        .mockResolvedValueOnce({
          id: 'rp1',
          status: 'EXPIRED',
          senderId: 'u1',
          amount: 1000,
        })
      // returnPacket 内部再次 update
      prisma.redPacket.update.mockResolvedValue({
        id: 'rp1',
        status: 'EXPIRED',
        senderId: 'u1',
        amount: 1000,
      })
      // 乐观锁：redPacket.updateMany 返回 count=1 表示标记过期成功
      prisma.redPacket.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 0,
          frozenBalance: 1000,
        })
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 1000,
          frozenBalance: 0,
        })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.expireReturn('rp1')
      expect(result!.status).toBe('EXPIRED')
      // 冻结释放回可用
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', frozenBalance: { gte: 1000 } },
          data: {
            availableBalance: { increment: 1000 },
            frozenBalance: { decrement: 1000 },
          },
        }),
      )
      // 退回账单
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            direction: 'INCOME',
            remark: '红包过期退回',
          }),
        }),
      )
    })
  })
})
