import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { WithdrawalsService } from './withdrawals.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { RiskEngineService } from '../risk/risk-engine.service'
import { MockChannel } from '../payment-channels/channels/mock.channel'
import { JournalService } from '../finance/journal.service'
import { CryptoService } from '../crypto/crypto.service'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type ChannelRegistryMock = Record<'getChannel' | 'getEnabledConfig' | 'getChannelByType', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction', jest.Mock>
type JournalServiceMock = { createEntries: jest.Mock }
type CryptoServiceMock = { encrypt: jest.Mock; decrypt: jest.Mock; mask: jest.Mock }
type PrismaMock = {
  $transaction: jest.Mock
  systemConfig: Record<string, jest.Mock>
  merchant: Record<string, jest.Mock>
  user: Record<string, jest.Mock>
  withdrawalOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  riskEvent: Record<string, jest.Mock>
} & Record<string, unknown>

describe('WithdrawalsService', () => {
  let service: WithdrawalsService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let riskEngine: RiskEngineMock
  let journalService: JournalServiceMock
  let cryptoService: CryptoServiceMock
  let mockChannel: MockChannel

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      systemConfig: { findUnique: jest.fn() },
      merchant: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      withdrawalOrder: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
    }

    usersService = {
      findById: jest.fn(),
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
    }

    journalService = {
      createEntries: jest.fn().mockResolvedValue(undefined),
    }

    // CryptoService：encrypt/decrypt 互为逆运算，mask 用于脱敏展示
    cryptoService = {
      encrypt: jest.fn((plain: string) => `ENC(${plain})`),
      decrypt: jest.fn((enc: string) => enc.replace(/^ENC\((.+)\)$/, '$1')),
      mask: jest.fn((v: string) => `MASK(${v})`),
    }

    // 默认非商户，走全局提现费率配置
    prisma.merchant.findUnique.mockResolvedValue(null)

    const module = await Test.createTestingModule({
      providers: [
        WithdrawalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: JournalService, useValue: journalService },
        { provide: CryptoService, useValue: cryptoService },
      ],
    }).compile()

    service = module.get(WithdrawalsService)
  })

  const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  describe('create 提现申请', () => {
    it('金额小于等于 0 报错', async () => {
      await expect(
        service.create('u1', { amount: 0, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('未实名不能提现', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ realNameStatus: 'PENDING' }))
      await expect(
        service.create('u1', { amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('冻结账户不能提现', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ status: 'FROZEN' }))
      await expect(
        service.create('u1', { amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('风控拦截时抛 ForbiddenException', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      riskEngine.check.mockResolvedValue({
        passed: false,
        blocked: true,
        warnings: [],
        rules: [
          { code: 'single_amount', name: '单笔金额限额', action: 'BLOCK', message: '超过限额' },
        ],
      })

      await expect(
        service.create('u1', { amount: 100000, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
      expect(riskEngine.check).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'WITHDRAW',
        amount: 10000000,
      })
      // 被拦截后不应冻结余额
      expect(prisma.account.updateMany).not.toHaveBeenCalled()
    })

    it('余额不足报错', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 100,
        frozenBalance: 0,
      })
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.create('u1', { amount: 50, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('正常提现：冻结余额、生成订单', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 10000,
          frozenBalance: 0,
        })
        .mockResolvedValue({
          id: 'a1',
          userId: 'u1',
          availableBalance: 9000,
          frozenBalance: 1000,
        })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.withdrawalOrder.create.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        status: 'PENDING',
      })

      const order = await service.create('u1', { amount: 10, payPassword: '123456', channelAccount: '6228' })
      expect(order.status).toBe('PENDING')
      expect(order.amount).toBe(1000)
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            availableBalance: { gte: 1000 },
          },
          data: {
            availableBalance: { decrement: 1000 },
            frozenBalance: { increment: 1000 },
          },
        }),
      )
      expect(prisma.accountLedger.create).toHaveBeenCalled()
      // channelAccount（银行卡号）属敏感信息，必须加密后入库
      expect(cryptoService.encrypt).toHaveBeenCalledWith('6228')
      expect(prisma.withdrawalOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channelAccount: 'ENC(6228)' }),
        }),
      )
    })

    it('未提供 channelAccount 时不调用加密', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 10000,
          frozenBalance: 0,
        })
        .mockResolvedValue({
          id: 'a1',
          userId: 'u1',
          availableBalance: 9000,
          frozenBalance: 1000,
        })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.withdrawalOrder.create.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        status: 'PENDING',
      })

      await service.create('u1', { amount: 10, payPassword: '123456' })
      expect(cryptoService.encrypt).not.toHaveBeenCalled()
    })

    it('手续费按费率计算', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.systemConfig.findUnique.mockResolvedValue({ value: '0.01' })
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 100000,
        frozenBalance: 0,
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.withdrawalOrder.create.mockImplementation((args: unknown) => {
        const query = args as { data: Record<string, unknown> }
        return Promise.resolve({ id: 'w1', ...query.data })
      })

      await service.create('u1', { amount: 10, payPassword: '123456' })
      expect(prisma.withdrawalOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 1000,
            fee: 10,
            actualAmount: 990,
          }),
        }),
      )
    })

    it('商户使用独立提现费率', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.merchant.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u1',
        withdrawRate: 200,
      })
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 100000,
        frozenBalance: 0,
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.withdrawalOrder.create.mockImplementation((args: unknown) => {
        const query = args as { data: Record<string, unknown> }
        return Promise.resolve({ id: 'w1', ...query.data })
      })

      await service.create('u1', { amount: 10, payPassword: '123456' })
      expect(prisma.withdrawalOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 1000,
            fee: 20,
            actualAmount: 980,
          }),
        }),
      )
    })

    it('幂等：相同 idempotencyKey 直接返回已有订单', async () => {
      usersService.findById.mockResolvedValue(verifiedUser())
      usersService.verifyPayPassword.mockResolvedValue(true)
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        userId: 'u1',
        amount: 1000,
        status: 'PENDING',
        idempotencyKey: 'key1',
      })

      const order = await service.create('u1', {
        amount: 10,
        payPassword: '123456',
        idempotencyKey: 'key1',
      })
      expect(order.id).toBe('w1')
      expect(prisma.account.updateMany).not.toHaveBeenCalled()
      expect(prisma.withdrawalOrder.create).not.toHaveBeenCalled()
    })
  })

  describe('approve 审核通过（发起代付）', () => {
    it('订单不存在报错', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue(null)
      await expect(service.approve('nope', 'admin1')).rejects.toThrow(NotFoundException)
    })

    it('非 PENDING 状态不能审核', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        status: 'SUCCESS',
        userId: 'u1',
        amount: 1000,
      })
      await expect(service.approve('w1', 'admin1')).rejects.toThrow(BadRequestException)
    })

    it('审核通过：发起代付、订单变 PROCESSING、冻结扣减总余额', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        status: 'PENDING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        // DB 中存储的是加密后的 channelAccount
        channelAccount: 'ENC(6228)',
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        nickname: '张三',
        identity: { realName: '张三' },
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 1000,
        totalBalance: 10000,
      })
      // 订单锁定（updateMany 返回 count=1 表示成功）
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 1 })
      // 冻结余额扣减（updateMany 返回 count=1 表示成功）
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.withdrawalOrder.update.mockResolvedValue({
        id: 'w1',
        status: 'PROCESSING',
      })

      const result = await service.approve('w1', 'admin1')
      // 订单先通过 updateMany 原子锁定为 PROCESSING
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'PROCESSING' }),
        }),
      )
      // 冻结余额减少，总余额减少（使用 updateMany 加 frozenBalance 条件）
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            frozenBalance: { gte: 1000 },
          },
          data: {
            frozenBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      // 传给渠道前需解密还原真实银行卡号
      expect(cryptoService.decrypt).toHaveBeenCalledWith('ENC(6228)')
      // 订单更新保存渠道订单号
      expect(prisma.withdrawalOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: 'mock',
            channelOrderNo: expect.any(String),
          }),
        }),
      )
    })

    it('渠道调用失败：状态守卫 FAILED 并退款，不回退 PENDING 避免双倍代付', async () => {
      // 模拟渠道 createPayout 抛错（网络/渠道异常）
      const payoutError = new Error('渠道超时')
      jest.spyOn(mockChannel, 'createPayout').mockRejectedValueOnce(payoutError)

      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        status: 'PENDING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        channelAccount: 'ENC(6228)',
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        nickname: '张三',
        identity: { realName: '张三' },
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 1000,
        totalBalance: 10000,
      })
      // 事务1：订单锁定 + 冻结扣减成功
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      // 事务2：失败路径状态守卫获胜（订单仍为 PROCESSING）
      prisma.withdrawalOrder.updateMany.mockResolvedValueOnce({ count: 1 })
      prisma.account.update.mockResolvedValue({
        id: 'a1',
        availableBalance: 10000,
        frozenBalance: 0,
        totalBalance: 10000,
      })

      await expect(service.approve('w1', 'admin1')).rejects.toThrow(BadRequestException)

      // 失败路径使用 updateMany + status:PROCESSING 状态守卫，仅获胜方退款
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1', status: 'PROCESSING' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      )
      // 退款：availableBalance 和 totalBalance 加回（approve 阶段已扣减 frozen+total）
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 不应回退为 PENDING（避免管理员重试导致双倍代付）
      expect(prisma.withdrawalOrder.update).not.toHaveBeenCalled()
    })

    it('渠道调用失败但状态已被回调改变：不重复退款（与回调竞态安全）', async () => {
      // 模拟渠道 createPayout 抛错，但代付回调已先行将订单置为 SUCCESS
      const payoutError = new Error('渠道超时')
      jest.spyOn(mockChannel, 'createPayout').mockRejectedValueOnce(payoutError)

      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        orderNo: 'W123',
        status: 'PENDING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        channelAccount: 'ENC(6228)',
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        nickname: '张三',
        identity: { realName: '张三' },
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 1000,
        totalBalance: 10000,
      })
      // 事务1：订单锁定 + 冻结扣减成功
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      // withdrawalOrder.updateMany 调用顺序：tx1 锁定(count=1) → tx2 状态守卫(count=0)
      prisma.withdrawalOrder.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })

      await expect(service.approve('w1', 'admin1')).rejects.toThrow(BadRequestException)
      // 状态守卫 count=0 时不应退款，避免与回调竞态导致余额双记
      expect(prisma.account.update).not.toHaveBeenCalled()
    })
  })

  describe('findByUser 查询用户提现订单', () => {
    it('channelAccount 解密并脱敏后返回', async () => {
      prisma.withdrawalOrder.findMany.mockResolvedValue([
        {
          id: 'w1',
          orderNo: 'W123',
          userId: 'u1',
          amount: 1000,
          status: 'PENDING',
          channelAccount: 'ENC(6228123456789012)',
        },
      ])

      const orders = await service.findByUser('u1')
      expect(cryptoService.decrypt).toHaveBeenCalledWith('ENC(6228123456789012)')
      expect(cryptoService.mask).toHaveBeenCalledWith('6228123456789012')
      expect(orders[0].channelAccount).toBe('MASK(6228123456789012)')
    })

    it('channelAccount 为空时原样返回不调用加解密', async () => {
      prisma.withdrawalOrder.findMany.mockResolvedValue([
        {
          id: 'w1',
          orderNo: 'W123',
          userId: 'u1',
          amount: 1000,
          status: 'PENDING',
          channelAccount: null,
        },
      ])

      const orders = await service.findByUser('u1')
      expect(orders[0].channelAccount).toBeNull()
      expect(cryptoService.decrypt).not.toHaveBeenCalled()
      expect(cryptoService.mask).not.toHaveBeenCalled()
    })

    it('解密失败（历史明文数据）时回退脱敏原值不影响列表展示', async () => {
      // 模拟历史明文数据：decrypt 抛错，应回退对原值脱敏
      cryptoService.decrypt.mockImplementationOnce(() => {
        throw new Error('解密失败')
      })
      prisma.withdrawalOrder.findMany.mockResolvedValue([
        {
          id: 'w1',
          orderNo: 'W123',
          userId: 'u1',
          amount: 1000,
          status: 'PENDING',
          channelAccount: '6228plaintext',
        },
      ])

      const orders = await service.findByUser('u1')
      // 解密失败回退：对原值脱敏
      expect(cryptoService.mask).toHaveBeenCalledWith('6228plaintext')
      expect(orders[0].channelAccount).toBe('MASK(6228plaintext)')
    })
  })

  describe('handlePayoutCallback 代付回调', () => {
    it('回调成功：订单标记 SUCCESS、生成账单', async () => {
      const orderNo = 'W123'
      const channelOrderNo = `MOCK_P_${orderNo}`

      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        orderNo,
        status: 'PROCESSING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        channel: 'mock',
        channelOrderNo,
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 0,
        totalBalance: 9000,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        status: 'SUCCESS',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}SUCCESS`)
      const headers = { 'x-signature': sig }

      const result = await service.handlePayoutCallback('mock', body, headers)

      expect(result).toBe('SUCCESS')
      expect(prisma.withdrawalOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      )
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'WITHDRAW',
            direction: 'EXPENSE',
            amount: 1000,
          }),
        }),
      )
    })

    it('回调失败：余额退回、订单标记 FAILED', async () => {
      const orderNo = 'W456'
      const channelOrderNo = `MOCK_P_${orderNo}`

      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w2',
        orderNo,
        status: 'PROCESSING',
        userId: 'u1',
        amount: 1000,
        fee: 1,
        actualAmount: 999,
        channel: 'mock',
        channelOrderNo,
      })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 9000,
        frozenBalance: 1000,
        totalBalance: 9000,
      })
      prisma.account.update.mockResolvedValue({
        availableBalance: 10000,
        frozenBalance: 0,
        totalBalance: 10000,
      })
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 1 })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        status: 'FAILED',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}FAILED`)
      const headers = { 'x-signature': sig }

      const result = await service.handlePayoutCallback('mock', body, headers)

      expect(result).toBe('SUCCESS')
      // 退回：可用余额增加，总余额增加（frozenBalance 在 approve 阶段已释放，不再变动）
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'w2', status: 'PROCESSING' }),
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      )
    })

    it('订单已成功：幂等返回', async () => {
      const orderNo = 'W789'
      const channelOrderNo = `MOCK_P_${orderNo}`

      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w3',
        orderNo,
        status: 'SUCCESS',
        userId: 'u1',
        amount: 1000,
        channel: 'mock',
        channelOrderNo,
      })

      const body = JSON.stringify({
        orderNo,
        channelOrderNo,
        status: 'SUCCESS',
      })
      const sig = mockChannel.sign(`${orderNo}${channelOrderNo}SUCCESS`)
      const headers = { 'x-signature': sig }

      const result = await service.handlePayoutCallback('mock', body, headers)
      expect(result).toBe('SUCCESS')
      expect(prisma.account.update).not.toHaveBeenCalled()
    })
  })

  describe('reject 审核拒绝', () => {
    it('拒绝：余额退回可用、冻结释放并生成退回账单', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        status: 'PENDING',
        userId: 'u1',
        amount: 1000,
      })
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 9000,
          frozenBalance: 1000,
        })
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 10000,
          frozenBalance: 0,
        })
      // 订单锁定（updateMany 返回 count=1 表示成功）
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 1 })
      // 冻结余额退回（updateMany 返回 count=1 表示成功）
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      await service.reject('w1', 'admin1', '信息有误')
      // 退回冻结余额使用 updateMany
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            frozenBalance: { gte: 1000 },
          },
          data: {
            availableBalance: { increment: 1000 },
            frozenBalance: { decrement: 1000 },
          },
        }),
      )
      // 订单状态更新使用 updateMany
      expect(prisma.withdrawalOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'REJECTED', remark: '信息有误' }),
        }),
      )
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'WITHDRAW',
            direction: 'INCOME',
            amount: 1000,
          }),
        }),
      )
    })

    it('已处理的订单不能拒绝', async () => {
      prisma.withdrawalOrder.findUnique.mockResolvedValue({
        id: 'w1',
        status: 'SUCCESS',
        userId: 'u1',
        amount: 1000,
      })
      // 订单锁定失败（updateMany 返回 count=0 表示状态不匹配）
      prisma.withdrawalOrder.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.reject('w1', 'admin1')).rejects.toThrow(BadRequestException)
    })
  })
})
