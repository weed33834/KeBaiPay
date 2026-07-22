import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ChannelReconciliationService } from './channel-reconciliation.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import {
  ChannelStatementStatus,
  MatchStatus,
  ReconciliationDiffStatus,
  ReconciliationDiffType,
} from '../common/enums'
import { KBErrorCodes } from '../common/error-codes'

/**
 * ChannelReconciliationService 单元测试
 *
 * 重点覆盖差异处理状态机的边界条件：
 *  - assignDifference 仅 PENDING 状态可指派
 *  - resolveDifference 仅 INVESTIGATING 状态可解决
 *  - finalStatus 必须是 RESOLVED 或 IGNORED
 */
describe('ChannelReconciliationService', () => {
  let service: ChannelReconciliationService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      channelStatement: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      channelStatementItem: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      reconciliationDifferenceItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      transactionOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      withdrawalOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    }

    const redis = {
      withLock: jest.fn((_, _ttl, fn) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        ChannelReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(ChannelReconciliationService)
  })

  // ============== getDifference ==============
  describe('getDifference', () => {
    it('差异不存在应抛 404', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue(null)
      await expect(service.getDifference('d1')).rejects.toThrow(NotFoundException)
    })

    it('差异存在应返回详情', async () => {
      const diff = {
        id: 'd1',
        status: ReconciliationDiffStatus.PENDING,
        diffType: ReconciliationDiffType.MISSING_IN_PLATFORM,
      }
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue(diff)
      await expect(service.getDifference('d1')).resolves.toEqual(diff)
    })
  })

  // ============== assignDifference ==============
  describe('assignDifference', () => {
    const dto = { assignedTo: 'finance-1' }

    it('差异不存在应抛 404', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue(null)
      await expect(service.assignDifference('d1', dto)).rejects.toThrow(NotFoundException)
    })

    it('状态非 PENDING 应抛 BadRequest（KB945）', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.INVESTIGATING,
      })
      await expect(service.assignDifference('d1', dto)).rejects.toThrow(BadRequestException)
    })

    it('状态为 RESOLVED 应抛 BadRequest', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.RESOLVED,
      })
      await expect(service.assignDifference('d1', dto)).rejects.toThrow(BadRequestException)
    })

    it('状态为 IGNORED 应抛 BadRequest', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.IGNORED,
      })
      await expect(service.assignDifference('d1', dto)).rejects.toThrow(BadRequestException)
    })

    it('状态为 PENDING 应成功，更新为 INVESTIGATING', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.PENDING,
      })
      const updated = {
        id: 'd1',
        status: ReconciliationDiffStatus.INVESTIGATING,
        assignedTo: 'finance-1',
      }
      prisma.reconciliationDifferenceItem.update.mockResolvedValue(updated)

      const result = await service.assignDifference('d1', dto)
      expect(result).toEqual(updated)
      expect(prisma.reconciliationDifferenceItem.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: {
          assignedTo: 'finance-1',
          status: ReconciliationDiffStatus.INVESTIGATING,
        },
      })
    })
  })

  // ============== resolveDifference ==============
  describe('resolveDifference', () => {
    const dto = { resolution: '已核实' }

    it('差异不存在应抛 404', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue(null)
      await expect(
        service.resolveDifference('d1', dto, 'admin-1'),
      ).rejects.toThrow(NotFoundException)
    })

    it('状态为 PENDING 应抛 BadRequest（必须先指派）', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.PENDING,
      })
      await expect(
        service.resolveDifference('d1', dto, 'admin-1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('状态为 RESOLVED 应抛 BadRequest', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.RESOLVED,
      })
      await expect(
        service.resolveDifference('d1', dto, 'admin-1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('状态为 INVESTIGATING 默认解决为 RESOLVED', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.INVESTIGATING,
      })
      const updated = {
        id: 'd1',
        status: ReconciliationDiffStatus.RESOLVED,
        resolution: '已核实',
        resolvedBy: 'admin-1',
      }
      prisma.reconciliationDifferenceItem.update.mockResolvedValue(updated)

      const result = await service.resolveDifference('d1', dto, 'admin-1')
      expect(result).toEqual(updated)
      expect(prisma.reconciliationDifferenceItem.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: expect.objectContaining({
          resolution: '已核实',
          resolvedBy: 'admin-1',
          status: ReconciliationDiffStatus.RESOLVED,
        }),
      })
    })

    it('finalStatus=IGNORED 时解决为 IGNORED', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.INVESTIGATING,
      })
      await service.resolveDifference(
        'd1',
        { resolution: '忽略', finalStatus: ReconciliationDiffStatus.IGNORED },
        'admin-1',
      )
      expect(prisma.reconciliationDifferenceItem.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: ReconciliationDiffStatus.IGNORED,
        }),
      })
    })

    it('finalStatus 非法时回退为 RESOLVED', async () => {
      prisma.reconciliationDifferenceItem.findUnique.mockResolvedValue({
        id: 'd1',
        status: ReconciliationDiffStatus.INVESTIGATING,
      })
      await service.resolveDifference(
        'd1',
        // finalStatus 是 PENDING（不允许），应回退到 RESOLVED
        { resolution: '测试', finalStatus: ReconciliationDiffStatus.PENDING as any },
        'admin-1',
      )
      expect(prisma.reconciliationDifferenceItem.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: ReconciliationDiffStatus.RESOLVED,
        }),
      })
    })
  })

  // ============== listDifferences / listStatements / listStatementItems ==============
  describe('listDifferences', () => {
    it('返回分页结果（空）', async () => {
      prisma.reconciliationDifferenceItem.findMany.mockResolvedValue([])
      prisma.reconciliationDifferenceItem.count.mockResolvedValue(0)
      const result = await service.listDifferences({ page: 1, limit: 10 })
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10 })
    })

    it('按状态过滤', async () => {
      prisma.reconciliationDifferenceItem.findMany.mockResolvedValue([])
      await service.listDifferences({ status: ReconciliationDiffStatus.PENDING })
      expect(prisma.reconciliationDifferenceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ReconciliationDiffStatus.PENDING }),
        }),
      )
    })
  })

  describe('listStatements', () => {
    it('返回分页结果', async () => {
      prisma.channelStatement.findMany.mockResolvedValue([])
      prisma.channelStatement.count.mockResolvedValue(0)
      const result = await service.listStatements({ page: 1, limit: 10 })
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10 })
    })

    it('按渠道过滤', async () => {
      await service.listStatements({ channelCode: 'mock' })
      expect(prisma.channelStatement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ channelCode: 'mock' }),
        }),
      )
    })
  })

  describe('listStatementItems', () => {
    it('对账单不存在应抛 404', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue(null)
      await expect(
        service.listStatementItems('s1', { page: 1, limit: 10 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('对账单存在返回分页条目', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue({ id: 's1' })
      prisma.channelStatementItem.findMany.mockResolvedValue([])
      prisma.channelStatementItem.count.mockResolvedValue(0)
      const result = await service.listStatementItems('s1', { page: 1, limit: 10 })
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10 })
    })
  })

  // ============== getStatement ==============
  describe('getStatement', () => {
    it('对账单不存在应抛 404', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue(null)
      await expect(service.getStatement('s1')).rejects.toThrow(NotFoundException)
    })

    it('对账单存在返回详情', async () => {
      const stmt = {
        id: 's1',
        status: ChannelStatementStatus.FETCHED,
        items: [],
      }
      prisma.channelStatement.findUnique.mockResolvedValue(stmt)
      await expect(service.getStatement('s1')).resolves.toEqual(stmt)
    })
  })

  // ============== matchStatement ==============
  describe('matchStatement', () => {
    it('对账单不存在应抛 404', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue(null)
      await expect(service.matchStatement('s1')).rejects.toThrow(NotFoundException)
    })

    it('对账单非 FETCHED 应抛 BadRequest（KB943）', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue({
        id: 's1',
        status: ChannelStatementStatus.PENDING,
        items: [],
      })
      await expect(service.matchStatement('s1')).rejects.toThrow(BadRequestException)
    })

    it('FETCHED 状态对账单可匹配，无 items 时返回全 0 统计', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue({
        id: 's1',
        status: ChannelStatementStatus.FETCHED,
        date: '2026-07-21',
        channelCode: 'mock',
        items: [],
      })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.withdrawalOrder.findMany.mockResolvedValue([])
      const result = await service.matchStatement('s1')
      expect(result).toEqual({
        statementId: 's1',
        matched: 0,
        mismatched: 0,
        unmatched: 0,
        missingInChannel: 0,
        totalDifferences: 0,
      })
    })
  })

  // ============== fetchStatement ==============
  describe('fetchStatement', () => {
    it('已 FETCHED 的对账单重复拉取应抛 BadRequest（KB941）', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue({
        id: 's1',
        status: ChannelStatementStatus.FETCHED,
      })
      await expect(
        service.fetchStatement(
          { channelCode: 'mock', date: '2026-07-21' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('首次拉取应成功，状态变 FETCHED', async () => {
      prisma.channelStatement.findUnique.mockResolvedValue(null)
      prisma.channelStatement.upsert.mockResolvedValue({
        id: 's1',
        status: ChannelStatementStatus.FETCHED,
        items: [],
      })
      prisma.channelStatement.findUnique.mockResolvedValueOnce(null) // 第一次校验
      prisma.channelStatement.findUnique.mockResolvedValueOnce({ // getStatement 二次查询
        id: 's1',
        status: ChannelStatementStatus.FETCHED,
        items: [],
      })
      prisma.transactionOrder.findMany.mockResolvedValue([])
      prisma.withdrawalOrder.findMany.mockResolvedValue([])
      prisma.channelStatementItem.createMany.mockResolvedValue({ count: 0 })

      const result = await service.fetchStatement(
        { channelCode: 'mock', date: '2026-07-21' },
        'admin-1',
      )
      expect(result).toEqual(
        expect.objectContaining({
          id: 's1',
          status: ChannelStatementStatus.FETCHED,
        }),
      )
    })
  })
})
