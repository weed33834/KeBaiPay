import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { BatchTransfersService } from './batch-transfers.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { BatchTransferStatus, BatchItemStatus } from '../common/enums'
import { KBErrorCodes } from '../common/error-codes'

describe('BatchTransfersService', () => {
  let service: BatchTransfersService
  let prisma: any
  let usersService: any
  let riskEngine: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      batchTransfer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      batchTransferItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ availableBalance: 100 }),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
      transactionOrder: { create: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') return cb(prisma)
        const results = []
        for (const op of cb) results.push(await op)
        return results
      }),
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn().mockResolvedValue(true),
      checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(undefined),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ blocked: false, rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        BatchTransfersService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()
    service = module.get(BatchTransfersService)
  })

  const buildDto = (overrides: any = {}) => ({
    items: [{ toUserId: 'u2', amount: 1.5 }],
    payPassword: '123456',
    ...overrides,
  })

  describe('createBatch 创建批次', () => {
    it('明细为空抛 BATCH_TRANSFER_EMPTY', async () => {
      await expect(
        service.createBatch('u1', buildDto({ items: [] })),
      ).rejects.toMatchObject({
        message: expect.stringContaining(KBErrorCodes.BATCH_TRANSFER_EMPTY),
      })
    })

    it('明细数超过上限抛 BATCH_TRANSFER_TOO_MANY', async () => {
      const items = Array.from({ length: 501 }, () => ({
        toUserId: 'u2',
        amount: 1,
      }))
      await expect(
        service.createBatch('u1', buildDto({ items })),
      ).rejects.toMatchObject({
        message: expect.stringContaining(KBErrorCodes.BATCH_TRANSFER_TOO_MANY),
      })
    })

    it('明细重复收款方抛 BATCH_TRANSFER_ITEM_DUPLICATED', async () => {
      await expect(
        service.createBatch(
          'u1',
          buildDto({
            items: [
              { toUserId: 'u2', amount: 1 },
              { toUserId: 'u2', amount: 2 },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining(KBErrorCodes.BATCH_TRANSFER_ITEM_DUPLICATED),
      })
    })

    it('包含自己抛 TRANSFER_TO_SELF', async () => {
      await expect(
        service.createBatch(
          'u1',
          buildDto({
            items: [{ toUserId: 'u1', amount: 1 }],
          }),
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining(KBErrorCodes.TRANSFER_TO_SELF),
      })
    })

    it('sender 未实名抛 REAL_NAME_REQUIRED', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'UNVERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      await expect(
        service.createBatch('u1', buildDto()),
      ).rejects.toThrow(ForbiddenException)
    })

    it('风控拦截抛 FORBIDDEN', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      riskEngine.check.mockResolvedValueOnce({
        blocked: true,
        rules: [{ name: 'RR1', action: 'BLOCK' }],
      })
      await expect(
        service.createBatch('u1', buildDto()),
      ).rejects.toThrow(ForbiddenException)
    })

    it('正常批次：扣款冻结 + 逐笔处理 + 标记 COMPLETED', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })

      // 主事务：落批次记录
      const fakeBatch = {
        id: 'b1',
        batchNo: 'BT1',
        senderId: 'u1',
        status: BatchTransferStatus.PROCESSING,
        items: [{ id: 'i1', toUserId: 'u2', amount: 150, status: 'PENDING' }],
      }
      prisma.batchTransfer.create.mockResolvedValue(fakeBatch)
      prisma.transactionOrder.create.mockResolvedValue({ id: 'tx1' })
      // 收尾时 findUnique 返回更新后的状态
      prisma.batchTransfer.findUnique.mockResolvedValue({
        ...fakeBatch,
        status: BatchTransferStatus.COMPLETED,
        successCount: 1,
        failedCount: 0,
      })

      // 余额校验：sender 账户存在、余额充足
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 10000,
        frozenBalance: 0,
        status: 'ACTIVE',
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      // processItem 内部：item + toUser + senderAccount
      prisma.batchTransferItem.findUnique.mockResolvedValue({
        id: 'i1',
        toUserId: 'u2',
        amount: 150,
        status: 'PENDING',
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'u2',
        nickname: 'UserB',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        account: { id: 'a2', status: 'ACTIVE', availableBalance: 0 },
      })

      const result = await service.createBatch('u1', buildDto())
      expect(result!.status).toBe(BatchTransferStatus.COMPLETED)
      expect(result!.successCount).toBe(1)
      expect(result!.failedCount).toBe(0)
    })

    it('明细收款方不存在：标记 FAILED + 退回冻结', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })

      const fakeBatch = {
        id: 'b1',
        batchNo: 'BT1',
        senderId: 'u1',
        status: BatchTransferStatus.PROCESSING,
        items: [{ id: 'i1', toUserId: 'unknown', amount: 150, status: 'PENDING' }],
      }
      prisma.batchTransfer.create.mockResolvedValue(fakeBatch)
      prisma.batchTransfer.findUnique.mockResolvedValue({
        ...fakeBatch,
        status: BatchTransferStatus.COMPLETED,
        successCount: 0,
        failedCount: 1,
      })
      prisma.transactionOrder.create.mockResolvedValue({ id: 'tx1' })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 10000,
        frozenBalance: 150,
        status: 'ACTIVE',
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      // processItem 内部：item 存在，toUser 不存在
      prisma.batchTransferItem.findUnique.mockResolvedValue({
        id: 'i1',
        toUserId: 'unknown',
        amount: 150,
        status: 'PENDING',
      })
      prisma.user.findUnique.mockResolvedValue(null)

      const result = await service.createBatch('u1', buildDto())
      expect(result!.status).toBe(BatchTransferStatus.COMPLETED)
      expect(result!.successCount).toBe(0)
      expect(result!.failedCount).toBe(1)
    })
  })

  describe('findByBatchNo 查询', () => {
    it('批次不存在抛 BATCH_TRANSFER_NOT_FOUND', async () => {
      prisma.batchTransfer.findUnique.mockResolvedValue(null)
      await expect(service.findByBatchNo('u1', 'BT1')).rejects.toThrow(NotFoundException)
    })

    it('非发送方查询抛 FORBIDDEN', async () => {
      prisma.batchTransfer.findUnique.mockResolvedValue({
        id: 'b1',
        batchNo: 'BT1',
        senderId: 'u2',
      })
      await expect(service.findByBatchNo('u1', 'BT1')).rejects.toThrow(ForbiddenException)
    })

    it('发送方可查询', async () => {
      const batch = { id: 'b1', batchNo: 'BT1', senderId: 'u1', items: [] }
      prisma.batchTransfer.findUnique.mockResolvedValue(batch)
      const result = await service.findByBatchNo('u1', 'BT1')
      expect(result).toEqual(batch)
    })
  })

  describe('list 列表', () => {
    it('默认分页', async () => {
      prisma.batchTransfer.findMany.mockResolvedValue([{ id: 'b1' }])
      prisma.batchTransfer.count.mockResolvedValue(1)
      const result = await service.list('u1', {})
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(10)
    })

    it('status 过滤', async () => {
      prisma.batchTransfer.findMany.mockResolvedValue([])
      prisma.batchTransfer.count.mockResolvedValue(0)
      await service.list('u1', { status: 'COMPLETED' })
      expect(prisma.batchTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { senderId: 'u1', status: 'COMPLETED' },
        }),
      )
    })
  })

  describe('cancel 取消', () => {
    it('批次不存在抛 BATCH_TRANSFER_NOT_FOUND', async () => {
      prisma.batchTransfer.findUnique.mockResolvedValue(null)
      await expect(service.cancel('u1', 'BT1')).rejects.toThrow(NotFoundException)
    })

    it('非发送方取消抛 FORBIDDEN', async () => {
      prisma.batchTransfer.findUnique.mockResolvedValue({
        id: 'b1',
        batchNo: 'BT1',
        senderId: 'u2',
        status: 'PROCESSING',
        items: [],
      })
      await expect(service.cancel('u1', 'BT1')).rejects.toThrow(ForbiddenException)
    })

    it('COMPLETED 状态不可取消抛 NOT_CANCELLABLE', async () => {
      prisma.batchTransfer.findUnique.mockResolvedValue({
        id: 'b1',
        batchNo: 'BT1',
        senderId: 'u1',
        status: BatchTransferStatus.COMPLETED,
        items: [],
      })
      await expect(service.cancel('u1', 'BT1')).rejects.toThrow(BadRequestException)
    })

    it('PROCESSING + 有 PENDING 明细：退回未处理资金 + 标记 CANCELLED', async () => {
      // 第一次 findUnique 返回批次（含 PENDING 明细），第二次返回更新后 CANCELLED 状态
      prisma.batchTransfer.findUnique
        .mockResolvedValueOnce({
          id: 'b1',
          batchNo: 'BT1',
          senderId: 'u1',
          status: BatchTransferStatus.PROCESSING,
          items: [
            { id: 'i1', status: 'SUCCESS', amount: 100 },
            { id: 'i2', status: 'PENDING', amount: 50 },
          ],
        })
        .mockResolvedValueOnce({
          id: 'b1',
          batchNo: 'BT1',
          senderId: 'u1',
          status: BatchTransferStatus.CANCELLED,
          successCount: 1,
          failedCount: 1,
          items: [],
        })
      prisma.batchTransferItem.findMany.mockResolvedValue([
        { id: 'i1', status: 'SUCCESS' },
        { id: 'i2', status: 'FAILED' },
      ])
      prisma.transactionOrder.create.mockResolvedValue({ id: 'tx1' })
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 100,
        frozenBalance: 50,
        status: 'ACTIVE',
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.batchTransfer.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.cancel('u1', 'BT1')
      expect(result!.status).toBe(BatchTransferStatus.CANCELLED)
      expect(result!.successCount).toBe(1)
      expect(result!.failedCount).toBe(1)
    })
  })
})
