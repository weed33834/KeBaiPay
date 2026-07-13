import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { WebhooksService } from './webhooks.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { TransactionsService } from '../transactions/transactions.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { RefundService } from '../payment-channels/refund.service'

type PrismaMock = { webhookLog: { create: jest.Mock } }
type RedisMock = {
  isEnabled: jest.Mock
  withLock: jest.Mock
  get: jest.Mock
  set: jest.Mock
}
type ChannelRegistryMock = {
  getChannel: jest.Mock
  getEnabledConfig: jest.Mock
}
type TransactionsMock = { handleRechargeCallback: jest.Mock }
type WithdrawalsMock = { handlePayoutCallback: jest.Mock }
type RefundMock = { handleRefundCallback: jest.Mock }

describe('WebhooksService', () => {
  let service: WebhooksService
  let prisma: PrismaMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let transactions: TransactionsMock
  let withdrawals: WithdrawalsMock
  let refund: RefundMock

  beforeEach(async () => {
    prisma = { webhookLog: { create: jest.fn().mockResolvedValue(undefined) } }
    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      // 锁直接执行回调，方便测试业务逻辑
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    }
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue({}),
      getEnabledConfig: jest.fn().mockResolvedValue({ config: {} }),
    }
    transactions = { handleRechargeCallback: jest.fn().mockResolvedValue('RECHARGE_OK') }
    withdrawals = { handlePayoutCallback: jest.fn().mockResolvedValue('PAYOUT_OK') }
    refund = { handleRefundCallback: jest.fn().mockResolvedValue('REFUND_OK') }

    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: TransactionsService, useValue: transactions },
        { provide: WithdrawalsService, useValue: withdrawals },
        { provide: RefundService, useValue: refund },
      ],
    }).compile()

    service = module.get(WebhooksService)
  })

  describe('handleRechargeCallback', () => {
    it('幂等命中时直接返回成功响应，不调用业务 service', async () => {
      redis.get.mockResolvedValue('1')
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})
      expect(res).toBe('success')
      expect(transactions.handleRechargeCallback).not.toHaveBeenCalled()
    })

    it('正常路径：验签 -> 处理 -> 写幂等 -> 落库 SUCCESS', async () => {
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})
      expect(res).toBe('RECHARGE_OK')
      expect(transactions.handleRechargeCallback).toHaveBeenCalled()
      expect(redis.set).toHaveBeenCalledWith(expect.any(String), '1', 86400)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channelCode: 'alipay', callbackType: 'recharge', status: 'SUCCESS' }),
        }),
      )
    })

    it('业务异常时落库 PROCESS_ERROR 并重新抛出', async () => {
      transactions.handleRechargeCallback.mockRejectedValue(new Error('boom'))
      await expect(service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})).rejects.toThrow('boom')
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PROCESS_ERROR', errorMessage: 'boom' }),
        }),
      )
    })

    it('微信回调使用 rawBody hash 作为锁 key 后缀，避免退化为 unknown', async () => {
      await service.handleRechargeCallback('wechat', '{"encrypted":"data"}', {})
      const lockKey = redis.withLock.mock.calls[0][0] as string
      expect(lockKey).toMatch(/^webhook:recharge:wechat:hash:[a-f0-9]{16}$/)
    })
  })

  describe('handlePayoutCallback', () => {
    it('正常路径调用 withdrawalsService 并落库', async () => {
      const res = await service.handlePayoutCallback('alipay', 'out_trade_no=W1', {})
      expect(res).toBe('PAYOUT_OK')
      expect(withdrawals.handlePayoutCallback).toHaveBeenCalled()
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ callbackType: 'payout', status: 'SUCCESS' }),
        }),
      )
    })

    it('业务异常时落库 PROCESS_ERROR', async () => {
      withdrawals.handlePayoutCallback.mockRejectedValue(new Error('payout-fail'))
      await expect(service.handlePayoutCallback('alipay', 'out_trade_no=W1', {})).rejects.toThrow('payout-fail')
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PROCESS_ERROR', errorMessage: 'payout-fail' }),
        }),
      )
    })
  })

  describe('handleRefundCallback', () => {
    it('正常路径调用 refundService 并落库', async () => {
      const res = await service.handleRefundCallback('alipay', 'out_request_no=R1', {})
      expect(res).toBe('REFUND_OK')
      expect(refund.handleRefundCallback).toHaveBeenCalled()
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ callbackType: 'refund', status: 'SUCCESS' }),
        }),
      )
    })
  })

  describe('verifySignature 渠道实现了 verifyWebhookSignature', () => {
    it('验签返回 false 时抛 BadRequestException 并落库 SIGNATURE_FAILED', async () => {
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockReturnValue(false),
      })
      await expect(
        service.handleRechargeCallback('wechat', '{"x":1}', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SIGNATURE_FAILED' }),
        }),
      )
    })

    it('验签过程抛错时落库 SIGNATURE_ERROR 并拒绝处理', async () => {
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockImplementation(() => {
          throw new Error('sig-throw')
        }),
      })
      await expect(
        service.handleRechargeCallback('wechat', '{"x":1}', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SIGNATURE_ERROR' }),
        }),
      )
    })
  })

  describe('logCallback 容错', () => {
    it('落库失败时仅记录日志，不影响主流程', async () => {
      prisma.webhookLog.create.mockRejectedValue(new Error('db-down'))
      // 主流程不应抛错（logCallback 内部 catch），仍返回业务结果
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O2', {})
      expect(res).toBe('RECHARGE_OK')
    })
  })
})
