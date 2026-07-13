import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { TransactionsService } from './transactions.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { RiskEngineService } from '../risk/risk-engine.service'
import { MockChannel } from '../payment-channels/channels/mock.channel'
import { JournalService } from '../finance/journal.service'

type UsersServiceMock = Record<'verifyPayPassword', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type ChannelRegistryMock = Record<'getChannel' | 'getEnabledConfig' | 'getChannelByType', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction' | 'recordTransactionFrequency', jest.Mock>
type JournalServiceMock = { createEntries: jest.Mock }
type PrismaMock = {
  $transaction: jest.Mock
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
} & Record<string, unknown>

describe('TransactionsService', () => {
  let service: TransactionsService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let riskEngine: RiskEngineMock
  let journalService: JournalServiceMock
  let mockChannel: MockChannel

  beforeEach(async () => {
    // P0-5: recharge 已移除 '/webhooks/recharge/mock' fallback，测试需显式提供
    process.env.RECHARGE_NOTIFY_URL = 'http://localhost:3000/webhooks/recharge/mock'

    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      transactionOrder: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
    }

    usersService = {
      verifyPayPassword: jest.fn(),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    }

    mockChannel = new MockChannel()
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getEnabledConfig: jest.fn().mockResolvedValue({ code: 'mock', name: '模拟渠道', config: {} }),
      getChannelByType: jest.fn().mockResolvedValue({
        channel: mockChannel,
        config: {},
        code: 'mock',
      }),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
      recordTransactionFrequency: jest.fn().mockResolvedValue(undefined),
    }

    journalService = {
      createEntries: jest.fn().mockResolvedValue(undefined),
    }

    const module = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: JournalService, useValue: journalService },
      ],
    }).compile()

    service = module.get(TransactionsService)
  })

  describe('recharge 发起充值', () => {
    it('金额小于等于 0 报错', async () => {
      await expect(
        service.recharge('u1', 0, '123456'),
      ).rejects.toThrow(BadRequestException)
    })

    it('支付密码错误抛错', async () => {
      usersService.verifyPayPassword.mockRejectedValue(
        new BadRequestException('支付密码错误'),
      )
      await expect(
        service.recharge('u1', 10, 'wrong'),
      ).rejects.toThrow(BadRequestException)
      expect(usersService.verifyPayPassword).toHaveBeenCalledWith('u1', 'wrong')
    })

    it('发起充值：创建 PENDING 订单并返回支付参数', async () => {
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      prisma.transactionOrder.create.mockImplementation((args: unknown) => {
        const query = args as { data: Record<string, unknown> }
        return Promise.resolve({ id: 't1', ...query.data })
      })
      prisma.transactionOrder.update.mockResolvedValue({})

      const result = await service.recharge('u1', 10, '123456')

      // 订单状态为 PENDING
      expect(prisma.transactionOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RECHARGE',
            status: 'PENDING',
            amount: 1000,
            toUserId: 'u1',
            channel: 'mock',
          }),
        }),
      )
      // 返回支付参数
      expect(result.status).toBe('PENDING')
      expect(result.orderNo).toBeDefined()
      expect(result.channelOrderNo).toBeDefined()
      expect(result).toHaveProperty('payUrl')
    })

    it('幂等：相同 idempotencyKey 直接返回已有订单', async () => {
      const existingOrder = {
        id: 't1',
        orderNo: 'R1',
        status: 'PENDING',
        amount: 1000,
        idempotencyKey: 'idem-1',
      }
      prisma.transactionOrder.findUnique.mockResolvedValue(existingOrder)
      usersService.verifyPayPassword.mockResolvedValue(true)

      const result = await service.recharge('u1', 10, '123456', 'idem-1')
      expect(result).toBe(existingOrder)
      expect(prisma.transactionOrder.create).not.toHaveBeenCalled()
    })
  })

  describe('handleRechargeCallback 充值回调', () => {
    it('回调成功：订单入账、生成流水和账单', async () => {
      const orderNo = 'R123'
      const channelOrderNo = `MOCK_R_${orderNo}`
      const amount = 1000

      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 't1',
        orderNo,
        status: 'PENDING',
        amount,
        toUserId: 'u1',
        channel: 'mock',
        channelOrderNo,
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 1000,
      })
      prisma.account.update.mockResolvedValue({
        id: 'a1',
        availableBalance: 2000,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        amount,
        status: 'SUCCESS',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}${amount}`)
      const headers = { 'x-signature': sig }

      const result = await service.handleRechargeCallback('mock', body, headers)

      expect(result).toBe('SUCCESS')
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      expect(prisma.accountLedger.create).toHaveBeenCalled()
      expect(prisma.bill.create).toHaveBeenCalled()
      expect(prisma.transactionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      )
    })

    it('回调失败：订单标记为 FAILED，不入账', async () => {
      const orderNo = 'R456'
      const channelOrderNo = `MOCK_R_${orderNo}`
      const amount = 1000

      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 't2',
        orderNo,
        status: 'PENDING',
        amount,
        toUserId: 'u1',
        channel: 'mock',
        channelOrderNo,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        amount,
        status: 'FAILED',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}${amount}`)
      const headers = { 'x-signature': sig }

      const result = await service.handleRechargeCallback('mock', body, headers)

      expect(result).toBe('SUCCESS')
      expect(prisma.transactionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      )
      expect(prisma.account.update).not.toHaveBeenCalled()
    })

    it('订单已成功：幂等返回不重复入账', async () => {
      const orderNo = 'R789'
      const channelOrderNo = `MOCK_R_${orderNo}`
      const amount = 1000

      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 't3',
        orderNo,
        status: 'SUCCESS',
        amount,
        toUserId: 'u1',
        channel: 'mock',
        channelOrderNo,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        amount,
        status: 'SUCCESS',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}${amount}`)
      const headers = { 'x-signature': sig }

      const result = await service.handleRechargeCallback('mock', body, headers)
      expect(result).toBe('SUCCESS')
      expect(prisma.account.update).not.toHaveBeenCalled()
    })

    it('签名错误抛异常', async () => {
      const body = JSON.stringify({
        orderNo: 'R1',
        channelOrderNo: 'MOCK_R_R1',
        amount: 1000,
        status: 'SUCCESS',
      })
      const headers = { 'x-signature': 'wrong' }

      await expect(
        service.handleRechargeCallback('mock', body, headers),
      ).rejects.toThrow()
    })

    it('channelOrderNo 缺失时兜底补录：SUCCESS 回调入账并补录渠道订单号', async () => {
      // 场景：渠道调用成功后、持久化 channelOrderNo 前进程崩溃，
      // 订单 channelOrderNo 为空。回调经验签后以回调携带的 channelOrderNo 为准并补录。
      const orderNo = 'R900'
      const channelOrderNo = `MOCK_R_${orderNo}`
      const amount = 1000

      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 't900',
        orderNo,
        status: 'PENDING',
        amount,
        toUserId: 'u1',
        channel: 'mock',
        channelOrderNo: null,
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 1000,
      })
      prisma.account.update.mockResolvedValue({
        id: 'a1',
        availableBalance: 2000,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        amount,
        status: 'SUCCESS',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}${amount}`)
      const headers = { 'x-signature': sig }

      const result = await service.handleRechargeCallback('mock', body, headers)
      expect(result).toBe('SUCCESS')
      // 入账
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 补录 channelOrderNo 并标记 SUCCESS
      expect(prisma.transactionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't900' },
          data: expect.objectContaining({
            channelOrderNo,
            status: 'SUCCESS',
          }),
        }),
      )
    })

    it('channelOrderNo 缺失时兜底补录：FAILED 回调标记 FAILED 不入账', async () => {
      const orderNo = 'R901'
      const channelOrderNo = `MOCK_R_${orderNo}`
      const amount = 1000

      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 't901',
        orderNo,
        status: 'PENDING',
        amount,
        toUserId: 'u1',
        channel: 'mock',
        channelOrderNo: null,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        amount,
        status: 'FAILED',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}${amount}`)
      const headers = { 'x-signature': sig }

      const result = await service.handleRechargeCallback('mock', body, headers)
      expect(result).toBe('SUCCESS')
      // 补录 channelOrderNo 并标记 FAILED，不入账
      expect(prisma.transactionOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't901' },
          data: expect.objectContaining({
            channelOrderNo,
            status: 'FAILED',
          }),
        }),
      )
      expect(prisma.account.update).not.toHaveBeenCalled()
    })

    it('channelOrderNo 不匹配抛异常（防止伪造渠道订单号）', async () => {
      const orderNo = 'R902'
      const amount = 1000
      const orderChannelOrderNo = `MOCK_R_${orderNo}`
      const fakeChannelOrderNo = 'FAKE_OTHER_ORDER'

      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 't902',
        orderNo,
        status: 'PENDING',
        amount,
        toUserId: 'u1',
        channel: 'mock',
        channelOrderNo: orderChannelOrderNo,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo: fakeChannelOrderNo,
        amount,
        status: 'SUCCESS',
      })
      const sig = mockChannel.sign(`${orderNo}${fakeChannelOrderNo}${amount}`)
      const headers = { 'x-signature': sig }

      await expect(
        service.handleRechargeCallback('mock', body, headers),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.account.update).not.toHaveBeenCalled()
      expect(prisma.transactionOrder.update).not.toHaveBeenCalled()
    })
  })
})
