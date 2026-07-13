import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { RefundService } from './refund.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { TransactionStatus } from '../common/enums'

type PrismaMock = {
  transactionOrder: {
    findUnique: jest.Mock
    findFirst: jest.Mock
    create: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
    count: jest.Mock
    aggregate: jest.Mock
  }
  account: { findUnique: jest.Mock; update: jest.Mock }
  accountLedger: { create: jest.Mock }
  paymentOrder: { findUnique: jest.Mock; update: jest.Mock }
  $transaction: jest.Mock
}
type RedisMock = { withLock: jest.Mock }
type ChannelRegistryMock = { getChannel: jest.Mock; getEnabledConfig: jest.Mock }
type RiskMock = { recordTransaction: jest.Mock }

const baseOrder = {
  id: 'o1',
  orderNo: 'O1',
  status: TransactionStatus.SUCCESS,
  amount: 10000,
  fee: 100,
  toUserId: 'u1',
  fromUserId: 'u2',
  channel: 'mock',
  channelOrderNo: 'CH1',
}

describe('RefundService', () => {
  let service: RefundService
  let prisma: PrismaMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let risk: RiskMock
  let mockChannel: {
    refund: jest.Mock
    queryRefund: jest.Mock
    parseRefundCallback: jest.Mock
    buildRefundCallbackSuccess: jest.Mock
  }

  beforeEach(async () => {
    prisma = {
      transactionOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      account: { findUnique: jest.fn(), update: jest.fn() },
      accountLedger: { create: jest.fn() },
      paymentOrder: { findUnique: jest.fn(), update: jest.fn() },
      // $transaction 接收回调并把同一 prisma 对象作为 tx 传入，让 mock 复用
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    }
    redis = {
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    }
    mockChannel = {
      refund: jest.fn(),
      queryRefund: jest.fn(),
      parseRefundCallback: jest.fn(),
      buildRefundCallbackSuccess: jest.fn().mockReturnValue('OK'),
    }
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getEnabledConfig: jest.fn().mockResolvedValue({ config: {} }),
    }
    risk = { recordTransaction: jest.fn().mockResolvedValue(undefined) }

    const module = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: RiskEngineService, useValue: risk },
      ],
    }).compile()

    service = module.get(RefundService)
  })

  describe('createRefund', () => {
    it('退款金额 <= 0 抛 BadRequestException', async () => {
      await expect(service.createRefund('O1', 0)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('原订单不存在抛 NotFoundException', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('原订单状态非 SUCCESS 抛 BadRequestException', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue({ ...baseOrder, status: TransactionStatus.PENDING })
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('退款金额超过可退金额（amount - fee）抛 BadRequestException', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(baseOrder)
      await expect(service.createRefund('O1', 99999)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('幂等键命中已存在退款单时直接返回已有结果', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(baseOrder)
      prisma.transactionOrder.findFirst.mockResolvedValue({
        orderNo: 'RF_EXIST',
        channelOrderNo: 'CH_RF',
        status: TransactionStatus.SUCCESS,
      })
      const res = await service.createRefund('O1', 100, undefined, 'idem-key')
      expect(res).toEqual({ refundNo: 'RF_EXIST', channelRefundNo: 'CH_RF', status: TransactionStatus.SUCCESS })
      expect(prisma.transactionOrder.create).not.toHaveBeenCalled()
    })

    it('渠道返回 PROCESSING 时只创建订单并更新为 PROCESSING，不触发资金退回', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(baseOrder)
      prisma.transactionOrder.create.mockResolvedValue({ id: 'rf1', orderNo: 'RF1' })
      mockChannel.refund.mockResolvedValue({
        channelRefundNo: 'CH_RF',
        status: 'PROCESSING',
      })
      const res = await service.createRefund('O1', 100)
      expect(res.status).toBe('PROCESSING')
      expect(prisma.transactionOrder.update).toHaveBeenCalled()
      // PROCESSING 不会触发 processRefundSuccess 的资金退回流程
      expect(prisma.account.update).not.toHaveBeenCalled()
    })

    it('渠道抛错时订单置 FAILED 并抛 BadRequestException', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(baseOrder)
      prisma.transactionOrder.create.mockResolvedValue({ id: 'rf1', orderNo: 'RF1' })
      mockChannel.refund.mockRejectedValue(new Error('channel-down'))
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(BadRequestException)
      // 第二次 update 是置 FAILED
      const secondCall = prisma.transactionOrder.update.mock.calls[1][0]
      expect(secondCall.data.status).toBe(TransactionStatus.FAILED)
    })

    it('渠道返回 SUCCESS 时触发 processRefundSuccess 资金退回（含乐观锁 updateMany）', async () => {
      prisma.transactionOrder.findUnique
        .mockResolvedValueOnce(baseOrder) // createRefund 内查找原订单
        // processRefundSuccess 内查找退款单：status=PROCESSING 表示需要处理
        .mockResolvedValueOnce({ id: 'rf1', orderNo: 'RF1', status: TransactionStatus.PROCESSING, relatedOrderNo: 'O1' })
      prisma.transactionOrder.create.mockResolvedValue({ id: 'rf1', orderNo: 'RF1' })
      prisma.account.findUnique.mockResolvedValue({ id: 'a1', availableBalance: 1000 })
      prisma.account.update.mockResolvedValue({ id: 'a1', availableBalance: 900 })
      // 乐观锁：updateMany 返回 count=1 表示当前线程抢到扣款权
      prisma.transactionOrder.updateMany.mockResolvedValue({ count: 1 })
      mockChannel.refund.mockResolvedValue({ channelRefundNo: 'CH_RF', status: 'SUCCESS' })
      // processRefundSuccess 内查找原支付单（relatedOrderNo 链路）
      prisma.paymentOrder.findUnique.mockResolvedValue(null)

      const res = await service.createRefund('O1', 100)
      expect(res.status).toBe('SUCCESS')
      // 验证乐观锁条件：where 必须包含 status=PROCESSING
      const updateManyArgs = prisma.transactionOrder.updateMany.mock.calls[0][0]
      expect(updateManyArgs.where.status).toBe(TransactionStatus.PROCESSING)
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ availableBalance: { decrement: 100 } }) }),
      )
      // 风控频率记录被调用
      expect(risk.recordTransaction).toHaveBeenCalled()
    })
  })

  describe('queryRefund', () => {
    it('退款单不存在抛 NotFoundException', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      await expect(service.queryRefund('RF_NONE')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('已 SUCCESS 状态直接返回，不查询渠道', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 'rf1',
        orderNo: 'RF1',
        status: TransactionStatus.SUCCESS,
      })
      const res = await service.queryRefund('RF1')
      expect(res.status).toBe(TransactionStatus.SUCCESS)
      expect(mockChannel.queryRefund).not.toHaveBeenCalled()
    })

    it('PENDING 状态返回处理中提示，不查询渠道', async () => {
      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 'rf1',
        orderNo: 'RF1',
        status: TransactionStatus.PENDING,
      })
      const res = await service.queryRefund('RF1')
      expect(res.status).toBe(TransactionStatus.PENDING)
      expect(res.message).toBe('退款处理中')
      expect(mockChannel.queryRefund).not.toHaveBeenCalled()
    })

    it('PROCESSING 状态主动查询渠道并同步状态', async () => {
      prisma.transactionOrder.findUnique
        .mockResolvedValueOnce({
          id: 'rf1',
          orderNo: 'RF1',
          status: TransactionStatus.PROCESSING,
          channel: 'mock',
          channelOrderNo: 'CH_RF',
        })
        // processRefundSuccess 内查找退款单（状态已变 SUCCESS 时跳过）
        .mockResolvedValueOnce({
          id: 'rf1',
          orderNo: 'RF1',
          status: TransactionStatus.PROCESSING,
          relatedOrderNo: 'O1',
          amount: 100,
        })
      mockChannel.queryRefund.mockResolvedValue({ status: 'SUCCESS' })
      prisma.account.findUnique.mockResolvedValue({ id: 'a1', availableBalance: 1000 })
      prisma.account.update.mockResolvedValue({ id: 'a1', availableBalance: 900 })
      prisma.transactionOrder.updateMany.mockResolvedValue({ count: 1 })
      // queryRefund 内查找原订单（用于 toUserId）
      // 已在第二次 findUnique 返回的 relatedOrderNo='O1' 触发查找 originalOrder
      // 此处第三次 findUnique 返回 originalOrder
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      // processRefundSuccess 内查找 originalOrder（refundOrder.relatedOrderNo='O1'）
      // 注意原代码用 this.prisma.transactionOrder.findUnique 而非 tx，需补一次返回
      prisma.transactionOrder.findUnique.mockResolvedValueOnce({
        id: 'o1',
        orderNo: 'O1',
        toUserId: 'u1',
        relatedOrderNo: null,
      })

      const res = await service.queryRefund('RF1')
      expect(res.status).toBe('SUCCESS')
      expect(mockChannel.queryRefund).toHaveBeenCalled()
    })
  })

  describe('handleRefundCallback', () => {
    it('退款单不存在抛 NotFoundException', async () => {
      mockChannel.parseRefundCallback.mockReturnValue({ refundNo: 'RF1', status: 'SUCCESS' })
      prisma.transactionOrder.findUnique.mockResolvedValue(null)
      await expect(service.handleRefundCallback('mock', 'body', {})).rejects.toBeInstanceOf(NotFoundException)
    })

    it('已 SUCCESS/FAILED 状态幂等返回成功响应', async () => {
      mockChannel.parseRefundCallback.mockReturnValue({ refundNo: 'RF1', status: 'SUCCESS' })
      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 'rf1',
        orderNo: 'RF1',
        status: TransactionStatus.SUCCESS,
        channel: 'mock',
      })
      const res = await service.handleRefundCallback('mock', 'body', {})
      expect(res).toBe('OK')
      // 不应再次更新状态
      expect(prisma.transactionOrder.update).not.toHaveBeenCalled()
    })

    it('渠道不一致抛 BadRequestException', async () => {
      mockChannel.parseRefundCallback.mockReturnValue({ refundNo: 'RF1', status: 'SUCCESS' })
      prisma.transactionOrder.findUnique.mockResolvedValue({
        id: 'rf1',
        orderNo: 'RF1',
        status: TransactionStatus.PROCESSING,
        channel: 'alipay', // 与回调 channelCode='mock' 不一致
      })
      await expect(service.handleRefundCallback('mock', 'body', {})).rejects.toBeInstanceOf(BadRequestException)
    })

    it('退款成功时更新状态、退回资金、同步 paymentOrder.refundAmount', async () => {
      mockChannel.parseRefundCallback.mockReturnValue({
        refundNo: 'RF1',
        status: 'SUCCESS',
        channelRefundNo: 'CH_RF_NEW',
      })
      prisma.transactionOrder.findUnique
        // 第一次：查找退款单
        .mockResolvedValueOnce({
          id: 'rf1',
          orderNo: 'RF1',
          status: TransactionStatus.PROCESSING,
          channel: 'mock',
          channelOrderNo: null, // 回调来覆盖
          relatedOrderNo: 'O1',
          amount: 100,
        })
        // 第二次：查找 originalOrder
        .mockResolvedValueOnce({
          id: 'o1',
          orderNo: 'O1',
          toUserId: 'u1',
          relatedOrderNo: 'PO1', // 链到 paymentOrder
        })
      prisma.account.findUnique.mockResolvedValue({ id: 'a1', availableBalance: 1000 })
      prisma.account.update.mockResolvedValue({ id: 'a1', availableBalance: 900 })
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'po1',
        amount: 1000,
        refundAmount: 0,
      })

      const res = await service.handleRefundCallback('mock', 'body', {})
      expect(res).toBe('OK')
      // 验证状态更新（不再覆盖已有 channelOrderNo）
      const updateArgs = prisma.transactionOrder.update.mock.calls[0][0]
      expect(updateArgs.data.status).toBe(TransactionStatus.SUCCESS)
      expect(updateArgs.data.channelOrderNo).toBe('CH_RF_NEW')
      // 验证账户扣款
      expect(prisma.account.update).toHaveBeenCalled()
      // 验证 paymentOrder.refundAmount 累加
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ refundAmount: 100, refundedAt: expect.any(Date) }),
        }),
      )
    })
  })

  describe('getRefundStats', () => {
    it('返回总数、累计金额、待处理数', async () => {
      prisma.transactionOrder.count
        .mockResolvedValueOnce(5) // totalRefunds
        .mockResolvedValueOnce(2) // pendingRefunds
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: 12345 } })

      const res = await service.getRefundStats('u1')
      expect(res).toEqual({ totalRefunds: 5, totalRefundAmount: 12345, pendingRefunds: 2 })
    })

    it('无数据时返回 0', async () => {
      prisma.transactionOrder.count.mockResolvedValue(0)
      prisma.transactionOrder.aggregate.mockResolvedValue({ _sum: { amount: null } })
      const res = await service.getRefundStats('u1')
      expect(res).toEqual({ totalRefunds: 0, totalRefundAmount: 0, pendingRefunds: 0 })
    })
  })
})
