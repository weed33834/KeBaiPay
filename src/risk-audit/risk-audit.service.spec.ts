import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { RiskAuditService } from './risk-audit.service'
import { RiskAuditAiEngine } from './risk-audit-ai.engine'
import { PrismaService } from '../prisma/prisma.service'
import {
  RiskAuditSessionStatus,
  RiskAuditMessageRole,
  RiskAuditIntent,
} from '../common/enums'

describe('RiskAuditService', () => {
  let service: RiskAuditService
  let prisma: any
  let aiEngine: any

  beforeEach(async () => {
    prisma = {
      riskAuditSession: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      riskAuditMessage: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((arr) => Promise.all(arr)),
    }
    aiEngine = {
      handle: jest.fn().mockResolvedValue({
        role: RiskAuditMessageRole.ASSISTANT,
        content: 'AI 回复',
        intent: RiskAuditIntent.GREETING,
        metadata: null,
      }),
    }

    const module = await Test.createTestingModule({
      providers: [
        RiskAuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: RiskAuditAiEngine, useValue: aiEngine },
      ],
    }).compile()

    service = module.get(RiskAuditService)
  })

  // ============== createSession ==============
  describe('createSession', () => {
    it('成功创建会话并写入欢迎消息', async () => {
      prisma.riskAuditSession.create.mockResolvedValue({
        id: 's1',
        sessionNo: 'RAS001',
        userId: 'u1',
        status: RiskAuditSessionStatus.ACTIVE,
      })
      prisma.riskAuditMessage.create.mockResolvedValue({})
      prisma.riskAuditSession.findUnique.mockResolvedValueOnce({
        id: 's1',
        sessionNo: 'RAS001',
        userId: 'u1',
        status: RiskAuditSessionStatus.ACTIVE,
        messages: [{ role: 'SYSTEM', content: '欢迎' }],
      })

      const result = await service.createSession('u1', { title: '测试会话' })
      expect(result?.sessionNo).toBe('RAS001')
      expect(prisma.riskAuditSession.create).toHaveBeenCalled()
      expect(prisma.riskAuditMessage.create).toHaveBeenCalled()
    })

    it('无 title 时使用默认标题', async () => {
      prisma.riskAuditSession.create.mockResolvedValue({
        id: 's1',
        sessionNo: 'RAS001',
        userId: 'u1',
      })
      prisma.riskAuditSession.findUnique.mockResolvedValueOnce({ id: 's1', userId: 'u1', messages: [] })

      await service.createSession('u1', {})
      const createCall = prisma.riskAuditSession.create.mock.calls[0][0]
      expect(createCall.data.title).toBe('风控咨询会话')
    })
  })

  // ============== listMySessions ==============
  describe('listMySessions', () => {
    it('返回分页列表', async () => {
      prisma.riskAuditSession.findMany.mockResolvedValue([{ id: 's1' }])
      prisma.riskAuditSession.count.mockResolvedValue(1)
      const result = await service.listMySessions('u1', {})
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)
    })

    it('status 过滤生效', async () => {
      await service.listMySessions('u1', { status: 'ACTIVE' })
      expect(prisma.riskAuditSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: 'ACTIVE' },
        }),
      )
    })
  })

  // ============== listAllSessions ==============
  describe('listAllSessions', () => {
    it('返回所有会话', async () => {
      prisma.riskAuditSession.findMany.mockResolvedValue([])
      prisma.riskAuditSession.count.mockResolvedValue(0)
      const result = await service.listAllSessions({})
      expect(result.total).toBe(0)
    })
  })

  // ============== findBySessionNo ==============
  describe('findBySessionNo', () => {
    it('会话不存在应抛 404', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue(null)
      await expect(service.findBySessionNo('NOPE', 'u1')).rejects.toThrow(NotFoundException)
    })

    it('用户无权访问他人会话应抛 Forbidden', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        id: 's1',
        sessionNo: 'RAS001',
        userId: 'u-other',
      })
      await expect(service.findBySessionNo('RAS001', 'u1')).rejects.toThrow(ForbiddenException)
    })

    it('用户访问自己会话应成功', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        id: 's1',
        sessionNo: 'RAS001',
        userId: 'u1',
        messages: [],
      })
      const result = await service.findBySessionNo('RAS001', 'u1')
      expect(result?.sessionNo).toBe('RAS001')
    })

    it('管理员可访问任意会话', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        id: 's1',
        sessionNo: 'RAS001',
        userId: 'u-other',
        messages: [],
      })
      const result = await service.findBySessionNo('RAS001')
      expect(result?.sessionNo).toBe('RAS001')
    })
  })

  // ============== sendMessage ==============
  describe('sendMessage', () => {
    const mockSession = {
      id: 's1',
      sessionNo: 'RAS001',
      userId: 'u1',
      status: RiskAuditSessionStatus.ACTIVE,
    }

    it('消息为空应抛错', async () => {
      await expect(
        service.sendMessage('u1', 'RAS001', { content: '   ' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('会话不存在应抛 404', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue(null)
      await expect(
        service.sendMessage('u1', 'RAS001', { content: '你好' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('无权访问他人会话应抛 Forbidden', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        ...mockSession,
        userId: 'u-other',
      })
      await expect(
        service.sendMessage('u1', 'RAS001', { content: '你好' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('已关闭会话应抛错', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        ...mockSession,
        status: RiskAuditSessionStatus.CLOSED,
      })
      await expect(
        service.sendMessage('u1', 'RAS001', { content: '你好' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功发送消息并获取 AI 回复', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue(mockSession)
      prisma.riskAuditMessage.create
        .mockResolvedValueOnce({ id: 'm1', role: 'USER', content: '你好' })
        .mockResolvedValueOnce({ id: 'm2', role: 'ASSISTANT', content: 'AI 回复' })
      prisma.riskAuditSession.update.mockResolvedValue({})

      const result = await service.sendMessage('u1', 'RAS001', { content: '你好' })
      expect(result.sessionNo).toBe('RAS001')
      expect(result.intent).toBe(RiskAuditIntent.GREETING)
      expect(aiEngine.handle).toHaveBeenCalledWith('u1', '你好')
    })
  })

  // ============== closeSession ==============
  describe('closeSession', () => {
    const mockSession = {
      id: 's1',
      sessionNo: 'RAS001',
      userId: 'u1',
      status: RiskAuditSessionStatus.ACTIVE,
    }

    it('会话不存在应抛 404', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue(null)
      await expect(
        service.closeSession('u1', 'RAS001', {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('无权关闭他人会话应抛 Forbidden', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        ...mockSession,
        userId: 'u-other',
      })
      await expect(
        service.closeSession('u1', 'RAS001', {}),
      ).rejects.toThrow(ForbiddenException)
    })

    it('已关闭会话应抛错', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue({
        ...mockSession,
        status: RiskAuditSessionStatus.CLOSED,
      })
      await expect(
        service.closeSession('u1', 'RAS001', {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功关闭会话', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue(mockSession)
      prisma.riskAuditSession.updateMany.mockResolvedValue({ count: 1 })
      prisma.riskAuditSession.findUnique
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce({ ...mockSession, status: RiskAuditSessionStatus.CLOSED })

      const result = await service.closeSession('u1', 'RAS001', { summary: '问题已解决' })
      expect(result?.status).toBe(RiskAuditSessionStatus.CLOSED)
    })

    it('乐观锁失败应抛错', async () => {
      prisma.riskAuditSession.findUnique.mockResolvedValue(mockSession)
      prisma.riskAuditSession.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.closeSession('u1', 'RAS001', {}),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== getStats ==============
  describe('getStats', () => {
    it('返回统计数据', async () => {
      prisma.riskAuditSession.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3)  // active
        .mockResolvedValueOnce(7)  // closed
      prisma.riskAuditMessage.count.mockResolvedValue(50)

      const result = await service.getStats()
      expect(result.totalSessions).toBe(10)
      expect(result.activeSessions).toBe(3)
      expect(result.closedSessions).toBe(7)
      expect(result.messageCount).toBe(50)
    })
  })
})

// ============== AI 引擎测试 ==============
describe('RiskAuditAiEngine', () => {
  let engine: RiskAuditAiEngine
  let prisma: any
  let riskEngine: any

  beforeEach(() => {
    prisma = {
      riskEvent: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      transactionOrder: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      account: { findUnique: jest.fn().mockResolvedValue(null) },
    }
    riskEngine = { listAllRules: jest.fn().mockResolvedValue([]) }

    // 直接实例化以避免 DI 装饰器冲突
    engine = new RiskAuditAiEngine(prisma, riskEngine)
  })

  describe('detectIntent', () => {
    it('识别问候意图', () => {
      expect(engine.detectIntent('你好')).toBe(RiskAuditIntent.GREETING)
      expect(engine.detectIntent('help')).toBe(RiskAuditIntent.GREETING)
      expect(engine.detectIntent('能做什么')).toBe(RiskAuditIntent.GREETING)
    })

    it('识别规则查询意图', () => {
      expect(engine.detectIntent('我有哪些规则')).toBe(RiskAuditIntent.RULE_LIST)
      expect(engine.detectIntent('查询风控限额')).toBe(RiskAuditIntent.RULE_LIST)
    })

    it('识别事件查询意图', () => {
      expect(engine.detectIntent('查询我的风险事件')).toBe(RiskAuditIntent.EVENT_LIST)
    })

    it('识别拦截解释意图', () => {
      expect(engine.detectIntent('为什么我被拦截了')).toBe(RiskAuditIntent.EVENT_EXPLAIN)
      expect(engine.detectIntent('为何转账失败')).toBe(RiskAuditIntent.EVENT_EXPLAIN)
    })

    it('识别交易查询意图', () => {
      expect(engine.detectIntent('查询我最近的交易')).toBe(RiskAuditIntent.TRANSACTION_LIST)
    })

    it('识别账户状态意图', () => {
      expect(engine.detectIntent('查询账户状态')).toBe(RiskAuditIntent.ACCOUNT_STATUS)
    })

    it('识别申诉意图', () => {
      expect(engine.detectIntent('我要申诉')).toBe(RiskAuditIntent.APPEAL)
      expect(engine.detectIntent('帮我解冻账户')).toBe(RiskAuditIntent.APPEAL)
    })

    it('未识别意图返回 UNKNOWN', () => {
      expect(engine.detectIntent('今天天气怎么样')).toBe(RiskAuditIntent.UNKNOWN)
    })
  })

  describe('handle', () => {
    it('问候意图返回帮助信息', async () => {
      const result = await engine.handle('u1', '你好')
      expect(result.intent).toBe(RiskAuditIntent.GREETING)
      expect(result.content).toContain('风控助手')
    })

    it('规则列表查询', async () => {
      riskEngine.listAllRules.mockResolvedValue([
        { code: 'single_amount', name: '单笔金额限额', enabled: true, params: { maxAmount: 5000000 }, action: 'BLOCK' },
      ])
      const result = await engine.handle('u1', '查询风控规则')
      expect(result.intent).toBe(RiskAuditIntent.RULE_LIST)
      expect(result.content).toContain('单笔金额限额')
      expect(result.metadata.rules).toHaveLength(1)
    })

    it('事件列表查询（无事件）', async () => {
      const result = await engine.handle('u1', '我的风险事件')
      expect(result.intent).toBe(RiskAuditIntent.EVENT_LIST)
      expect(result.content).toContain('没有风险事件')
    })

    it('事件列表查询（有事件）', async () => {
      prisma.riskEvent.findMany.mockResolvedValue([
        { id: 'e1', type: 'LARGE_TRANSFER', level: 'HIGH', description: '大额转账', handled: false, createdAt: new Date('2026-07-21T00:00:00Z') },
      ])
      const result = await engine.handle('u1', '我的风险事件')
      expect(result.metadata.events).toHaveLength(1)
      expect(result.content).toContain('LARGE_TRANSFER')
    })

    it('交易查询（无交易）', async () => {
      const result = await engine.handle('u1', '我的交易')
      expect(result.intent).toBe(RiskAuditIntent.TRANSACTION_LIST)
      expect(result.content).toContain('没有交易记录')
    })

    it('账户状态查询（无用户）', async () => {
      const result = await engine.handle('u1', '我的账户状态')
      expect(result.intent).toBe(RiskAuditIntent.ACCOUNT_STATUS)
      expect(result.content).toContain('未找到用户')
    })

    it('账户状态查询（有用户和账户）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'ACTIVE', riskLevel: 'LOW' })
      prisma.account.findUnique.mockResolvedValue({ availableBalance: 10000, frozenBalance: 0, totalBalance: 10000 })
      const result = await engine.handle('u1', '我的账户状态')
      expect(result.content).toContain('账户正常')
      expect(result.content).toContain('¥100.00')
    })

    it('拦截解释（无未处理事件）', async () => {
      const result = await engine.handle('u1', '为什么被拦截')
      expect(result.intent).toBe(RiskAuditIntent.EVENT_EXPLAIN)
      expect(result.content).toContain('未找到')
    })

    it('拦截解释（有事件）', async () => {
      prisma.riskEvent.findFirst.mockResolvedValue({
        id: 'e1',
        type: 'LARGE_TRANSFER',
        level: 'HIGH',
        description: '大额转账触发限额',
        handled: false,
        createdAt: new Date('2026-07-21T00:00:00Z'),
      })
      riskEngine.listAllRules.mockResolvedValue([
        { code: 'single_amount', name: '单笔金额限额', enabled: true, params: { maxAmount: 5000000 }, action: 'BLOCK' },
      ])
      const result = await engine.handle('u1', '为什么被拦截')
      expect(result.content).toContain('LARGE_TRANSFER')
      expect(result.content).toContain('单笔金额限额')
      expect(result.content).toContain('建议')
    })

    it('申诉（无已存在工单）', async () => {
      prisma.riskEvent.findFirst.mockResolvedValue(null)
      prisma.riskEvent.create.mockResolvedValue({
        id: 'appeal-1',
        type: 'APPEAL',
        level: 'MEDIUM',
        description: '申诉',
        createdAt: new Date('2026-07-21T00:00:00Z'),
      })
      const result = await engine.handle('u1', '我要申诉')
      expect(result.intent).toBe(RiskAuditIntent.APPEAL)
      expect(result.content).toContain('申诉工单已创建')
      expect(prisma.riskEvent.create).toHaveBeenCalled()
    })

    it('申诉（已存在工单）', async () => {
      prisma.riskEvent.findFirst.mockResolvedValue({
        id: 'appeal-1',
        type: 'APPEAL',
        level: 'MEDIUM',
        description: '之前的申诉',
        createdAt: new Date('2026-07-21T00:00:00Z'),
      })
      const result = await engine.handle('u1', '我要申诉')
      expect(result.content).toContain('正在处理')
      expect(prisma.riskEvent.create).not.toHaveBeenCalled()
    })

    it('未识别意图返回兜底回复', async () => {
      const result = await engine.handle('u1', '今天天气怎么样')
      expect(result.intent).toBe(RiskAuditIntent.UNKNOWN)
      expect(result.content).toContain('没有理解')
    })
  })
})
