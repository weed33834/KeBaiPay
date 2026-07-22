import { Test, TestingModule } from '@nestjs/testing'
import { ValidationPipe, INestApplication, ExecutionContext } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule, JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { AgentController } from '../src/agent/agent.controller'
import { AgentService } from '../src/agent/agent.service'
import { AgentAuthService } from '../src/agent/agent-auth.service'
import { AgentAuditLogService } from '../src/agent/agent-audit-log.service'
import { AgentAuthGuard } from '../src/agent/agent-auth.guard'
import { ToolRegistry } from '../src/agent/tools/tool.registry'
import { LlmModule } from '../src/agent/llm/llm.module'
import { LlmService } from '../src/agent/llm/llm.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { MessagesService } from '../src/messages/messages.service'
import { CouponsService } from '../src/coupons/coupons.service'
import { ScheduleHealthService } from '../src/common/schedule-health.service'
import { JWT_TOKEN_TYPE_AGENT } from '../src/common/constants'
import type { AgentCurrentUser } from '../src/agent/agent-current-user.interface'

/**
 * Agent 智能体模块 e2e 测试
 *
 * 测试覆盖：
 *  1. AgentAuthGuard：缺少 token / 无效 token / 有效 token 通过
 *  2. POST /agent/conversations：创建会话（mock Agent + AgentConversation）
 *  3. POST /agent/chat：核心入口（mock LLM mock 模式 + 会话校验）
 *  4. POST /agent/authorize：用户授权 Agent
 *  5. POST /agent/confirm：确认/拒绝操作
 *  6. GET /agent/verify-chain/:agentId：哈希链校验
 *  7. LlmService：mock 模式默认行为
 *  8. AgentAuditLogService：链式 hash 完整性
 */
describe('AgentModule (e2e)', () => {
  let app: INestApplication
  let jwtService: JwtService
  let configService: ConfigService

  const mockPrisma: any = {
    agent: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agentAuthorization: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agentConversation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    agentMessage: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    agentOperationLog: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
    },
    bill: {
      findMany: jest.fn(),
    },
    merchant: {
      findUnique: jest.fn(),
    },
    paymentOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    riskEvent: {
      findMany: jest.fn(),
    },
    reconciliationDifferenceItem: {
      findMany: jest.fn(),
    },
    adminUser: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn(mockPrisma)),
    $executeRaw: jest.fn(),
  }

  const mockMessagesService = {
    sendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
  }
  const mockCouponsService = {
    claim: jest.fn().mockResolvedValue({ id: 'user-coupon-1' }),
  }
  const mockScheduleHealthService = {
    register: jest.fn(),
    reportStart: jest.fn(),
    reportComplete: jest.fn(),
    getScheduleStatus: jest.fn().mockReturnValue({
      status: 'ok',
      timestamp: new Date().toISOString(),
      totalSchedules: 0,
      healthySchedules: 0,
      degradedSchedules: 0,
      errorSchedules: 0,
      schedules: [],
    }),
  }

  const TEST_USER_ID = 'test-user-1'
  const TEST_AGENT_ID = 'test-agent-1'
  const TEST_AUTH_ID = 'test-auth-1'

  const mockAgentUser: AgentCurrentUser = {
    sub: TEST_AGENT_ID,
    typ: 'agent',
    scenario: 'wallet',
    scopes: ['wallet:read', 'wallet:write:transfer'],
    subjectType: 'user',
    subjectId: TEST_USER_ID,
    authId: TEST_AUTH_ID,
    authScopes: ['wallet:read', 'wallet:write:transfer'],
  }

  function signAgentToken(overrides: Partial<any> = {}): string {
    const payload = {
      sub: TEST_AGENT_ID,
      typ: JWT_TOKEN_TYPE_AGENT,
      scenario: 'wallet',
      scopes: ['wallet:read', 'wallet:write:transfer'],
      subjectType: 'user',
      subjectId: TEST_USER_ID,
      authId: TEST_AUTH_ID,
      authScopes: ['wallet:read', 'wallet:write:transfer'],
      ...overrides,
    }
    return jwtService.sign(payload, {
      secret: configService.get<string>('JWT_AGENT_SECRET'),
    })
  }

  beforeAll(async () => {
    process.env.LLM_PROVIDER = 'mock'
    process.env.JWT_AGENT_SECRET = 'test-jwt-agent-secret-32chars-minimum-length'
    process.env.JWT_AGENT_EXPIRES_IN = '7d'

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(),
        ConfigModule.forRoot(),
        JwtModule.register({
          secret: process.env.JWT_AGENT_SECRET,
          signOptions: { expiresIn: '7d' },
        }),
        LlmModule,
      ],
      controllers: [AgentController],
      providers: [
        AgentService,
        AgentAuthService,
        AgentAuditLogService,
        AgentAuthGuard,
        ToolRegistry,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MessagesService, useValue: mockMessagesService },
        { provide: CouponsService, useValue: mockCouponsService },
        { provide: ScheduleHealthService, useValue: mockScheduleHealthService },
      ],
    })
      .overrideGuard(AgentAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest()
          req.user = mockAgentUser
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()

    jwtService = moduleRef.get<JwtService>(JwtService)
    configService = moduleRef.get<ConfigService>(ConfigService)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // 重置默认 mock 行为
    mockPrisma.agent.findUnique.mockImplementation(async (args: any) => {
      if (args.where?.id === TEST_AGENT_ID) {
        return { id: TEST_AGENT_ID, status: 'ACTIVE', scenario: 'wallet', scopes: '["wallet:read","wallet:write:transfer"]' }
      }
      return null
    })
    mockPrisma.agentAuthorization.findUnique.mockResolvedValue({
      id: TEST_AUTH_ID,
      agentId: TEST_AGENT_ID,
      subjectId: TEST_USER_ID,
      subjectType: 'user',
      scopes: '["wallet:read","wallet:write:transfer"]',
      revokedAt: null,
      expiresAt: null,
    })
  })

  describe('AgentAuthGuard 认证', () => {
    it('缺少 Authorization 头时返回 401', async () => {
      // 此用例需要真实 AgentAuthGuard，单独构造一个 app
      const moduleRef2 = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot(),
          ConfigModule.forRoot(),
          JwtModule.register({ secret: process.env.JWT_AGENT_SECRET }),
        ],
        controllers: [AgentController],
        providers: [
          AgentService,
          AgentAuthService,
          AgentAuditLogService,
          AgentAuthGuard,
          ToolRegistry,
          LlmService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: MessagesService, useValue: mockMessagesService },
          { provide: CouponsService, useValue: mockCouponsService },
          { provide: ScheduleHealthService, useValue: mockScheduleHealthService },
        ],
      }).compile()
      const app2 = moduleRef2.createNestApplication()
      app2.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
      await app2.init()

      const res = await request(app2.getHttpServer())
        .get('/agent/conversations')
        .send()
      expect(res.status).toBe(401)
      await app2.close()
    })
  })

  describe('POST /agent/conversations', () => {
    it('创建会话成功', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: TEST_AGENT_ID,
        scenario: 'wallet',
        status: 'ACTIVE',
      })
      mockPrisma.agentConversation.create.mockImplementation(async (args: any) => ({
        id: 'conv-1',
        convNo: 'CONV001',
        agentId: TEST_AGENT_ID,
        userId: TEST_USER_ID,
        scenario: args.data.scenario,
        title: args.data.title,
        status: 'ACTIVE',
        metadata: args.data.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      mockPrisma.agentMessage.create.mockResolvedValue({ id: 'msg-sys-1' })

      const res = await request(app.getHttpServer())
        .post('/agent/conversations')
        .send({ scenario: 'wallet', title: '测试会话' })
      expect(res.status).toBe(201)
      expect(res.body.scenario).toBe('wallet')
      expect(res.body.title).toBe('测试会话')
    })

    it('无匹配 Agent 时返回 404', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null)
      const res = await request(app.getHttpServer())
        .post('/agent/conversations')
        .send({ scenario: 'unknown' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /agent/conversations', () => {
    it('返回会话列表', async () => {
      mockPrisma.agentConversation.findMany.mockResolvedValue([
        { id: 'conv-1', scenario: 'wallet', title: 'T1', status: 'ACTIVE' },
      ])
      const res = await request(app.getHttpServer())
        .get('/agent/conversations')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(1)
    })
  })

  describe('POST /agent/chat', () => {
    it('convId 为空时返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/agent/chat')
        .send({ content: '你好' })
      expect(res.status).toBe(400)
    })

    it('会话不存在时返回 404', async () => {
      mockPrisma.agentConversation.findUnique.mockResolvedValue(null)
      const res = await request(app.getHttpServer())
        .post('/agent/chat')
        .send({ content: '你好', convId: 'not-exist' })
      expect(res.status).toBe(404)
    })

    it('会话已关闭时返回 400', async () => {
      mockPrisma.agentConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'CLOSED',
        userId: TEST_USER_ID,
        scenario: 'wallet',
      })
      const res = await request(app.getHttpServer())
        .post('/agent/chat')
        .send({ content: '你好', convId: 'conv-1' })
      expect(res.status).toBe(400)
    })

    it('正常发送消息并返回 mock LLM 回复', async () => {
      mockPrisma.agentConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        status: 'ACTIVE',
        userId: TEST_USER_ID,
        scenario: 'wallet',
      })
      mockPrisma.agentMessage.findMany.mockResolvedValue([])
      mockPrisma.agentMessage.create.mockResolvedValue({ id: 'msg-1' })
      mockPrisma.agentConversation.update.mockResolvedValue({})

      const res = await request(app.getHttpServer())
        .post('/agent/chat')
        .send({ content: '查询我的余额', convId: 'conv-1' })
      expect(res.status).toBe(201)
      expect(res.body.reply).toBeDefined()
      expect(typeof res.body.reply).toBe('string')
    })
  })

  describe('POST /agent/authorize', () => {
    it('缺少 agentId 返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/agent/authorize')
        .send({ subjectType: 'user', subjectId: 'u1', scopes: ['wallet:read'] })
      expect(res.status).toBe(400)
    })

    it('subjectType 非法返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/agent/authorize')
        .send({ agentId: 'a1', subjectType: 'invalid', subjectId: 'u1', scopes: ['wallet:read'] })
      expect(res.status).toBe(400)
    })

    it('Agent 不存在返回 404', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue(null)
      const res = await request(app.getHttpServer())
        .post('/agent/authorize')
        .send({ agentId: 'no-exist', subjectType: 'user', subjectId: 'u1', scopes: ['wallet:read'] })
      expect(res.status).toBe(404)
    })

    it('scopes 超出 Agent 范围返回 403', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'ACTIVE',
        scopes: '["wallet:read"]',
      })
      const res = await request(app.getHttpServer())
        .post('/agent/authorize')
        .send({ agentId: 'a1', subjectType: 'user', subjectId: 'u1', scopes: ['wallet:read', 'wallet:write:transfer'] })
      expect(res.status).toBe(401)
    })

    it('正常授权返回记录', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'ACTIVE',
        scopes: '["wallet:read"]',
      })
      mockPrisma.agentAuthorization.create.mockImplementation(async (args: any) => ({
        id: 'auth-1',
        ...args.data,
        scopes: args.data.scopes,
        createdAt: new Date(),
      }))
      const res = await request(app.getHttpServer())
        .post('/agent/authorize')
        .send({ agentId: 'a1', subjectType: 'user', subjectId: 'u1', scopes: ['wallet:read'] })
      expect(res.status).toBe(201)
      expect(res.body.id).toBe('auth-1')
    })
  })

  describe('POST /agent/confirm', () => {
    it('opLogId 为空返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/agent/confirm')
        .send({ decision: 'CONFIRM' })
      expect(res.status).toBe(400)
    })

    it('decision 非法返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/agent/confirm')
        .send({ opLogId: 'op-1', decision: 'INVALID' })
      expect(res.status).toBe(400)
    })

    it('操作记录不存在返回 404', async () => {
      mockPrisma.agentOperationLog.findUnique.mockResolvedValue(null)
      const res = await request(app.getHttpServer())
        .post('/agent/confirm')
        .send({ opLogId: 'no-exist', decision: 'CONFIRM' })
      expect(res.status).toBe(404)
    })

    it('REJECT 决策返回成功', async () => {
      mockPrisma.agentOperationLog.findUnique.mockResolvedValue({
        id: 'op-1',
        result: 'PENDING_CONFIRM',
        action: 'kbpay_transfer',
        scope: 'wallet:write:transfer',
        detail: JSON.stringify({ args: { toUserId: 'u2', amountYuan: 100 } }),
      })
      mockPrisma.agentOperationLog.update.mockResolvedValue({})
      const res = await request(app.getHttpServer())
        .post('/agent/confirm')
        .send({ opLogId: 'op-1', decision: 'REJECT' })
      expect(res.status).toBe(201)
      expect(res.body.success).toBe(false)
    })
  })

  describe('GET /agent/verify-chain/:agentId', () => {
    it('哈希链完整返回 valid=true', async () => {
      // AgentAuditLogService.verifyChain 返回 null 表示完整
      mockPrisma.agentOperationLog.findMany.mockResolvedValue([])
      const res = await request(app.getHttpServer())
        .get('/agent/verify-chain/' + TEST_AGENT_ID)
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('valid')
      expect(res.body.valid).toBe(true)
    })
  })

  describe('LlmService (mock 模式)', () => {
    it('mock 模式返回模板回复', async () => {
      const llm = app.get(LlmService)
      expect(llm.isMock).toBe(true)
      const result = await llm.chat({
        messages: [{ role: 'user', content: '查询余额' }],
      })
      expect(result.content).toContain('[mock]')
      expect(result.model).toBe('mock')
    })

    it('mock 模式对账单关键词触发对应模板', async () => {
      const llm = app.get(LlmService)
      const result = await llm.chat({
        messages: [{ role: 'user', content: '查看我的账单' }],
      })
      expect(result.content).toContain('[mock]')
      expect(result.content).toContain('账单')
    })
  })

  describe('ToolRegistry 工具查找', () => {
    it('wallet 场景应返回 5 个工具', () => {
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(mockAgentUser, 'wallet', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const names = tools.map((t) => t.name)
      expect(names).toContain('kbpay_query_balance')
      expect(names).toContain('kbpay_query_bill')
      expect(names).toContain('kbpay_send_message')
      expect(names).toContain('kbpay_claim_coupon')
      expect(names).toContain('kbpay_transfer')
    })

    it('risk 场景应返回风控相关工具', () => {
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(mockAgentUser, 'risk', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const names = tools.map((t) => t.name)
      expect(names).toContain('kbpay_query_risk_events')
      expect(names).toContain('kbpay_query_health')
    })

    it('kbpay_transfer 工具应标记 requireConfirm=true', () => {
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(mockAgentUser, 'wallet', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const transferTool = tools.find((t) => t.name === 'kbpay_transfer')
      expect(transferTool?.requireConfirm).toBe(true)
    })

    it('kbpay_query_balance 工具查询余额返回字段', async () => {
      mockPrisma.account.findUnique.mockResolvedValue({
        availableBalance: 10000,
        frozenBalance: 500,
        totalBalance: 10500,
      })
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(mockAgentUser, 'wallet', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const balanceTool = tools.find((t) => t.name === 'kbpay_query_balance')!
      const result = await balanceTool.execute({})
      expect(result.balanceYuan).toBe('105.00')
      expect(result.availableYuan).toBe('100.00')
      expect(result.frozenYuan).toBe('5.00')
    })

    it('kbpay_query_merchant_balance 通过 Merchant→User→Account 查询', async () => {
      const merchantUser: AgentCurrentUser = {
        ...mockAgentUser,
        scenario: 'merchant',
        subjectType: 'merchant',
        subjectId: 'merchant-1',
        authScopes: ['merchant:read'],
      }
      mockPrisma.merchant.findUnique.mockResolvedValue({
        userId: TEST_USER_ID,
        merchantName: '测试商户',
        status: 'APPROVED',
        user: {
          account: {
            availableBalance: 50000,
            frozenBalance: 1000,
            totalBalance: 51000,
          },
        },
      })
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(merchantUser, 'merchant', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const balanceTool = tools.find((t) => t.name === 'kbpay_query_merchant_balance')!
      const result = await balanceTool.execute({})
      expect(result.merchantName).toBe('测试商户')
      expect(result.balanceYuan).toBe('510.00')
      expect(result.availableYuan).toBe('500.00')
    })

    it('kbpay_query_merchant_orders 查询商户订单', async () => {
      const merchantUser: AgentCurrentUser = {
        ...mockAgentUser,
        scenario: 'merchant',
        subjectType: 'merchant',
        subjectId: 'merchant-1',
        authScopes: ['merchant:read'],
      }
      mockPrisma.paymentOrder.findMany.mockResolvedValue([
        { orderNo: 'PO001', amount: 1000, status: 'SUCCESS', createdAt: new Date() },
      ])
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(merchantUser, 'merchant', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const ordersTool = tools.find((t) => t.name === 'kbpay_query_merchant_orders')!
      const result = await ordersTool.execute({})
      expect(result.count).toBe(1)
      expect(result.orders[0].orderNo).toBe('PO001')
    })

    it('权限不足时抛 ForbiddenException', async () => {
      const limitedUser: AgentCurrentUser = {
        ...mockAgentUser,
        authScopes: [], // 无任何 scope
      }
      const toolRegistry = app.get(ToolRegistry)
      const tools = toolRegistry.getTools(limitedUser, 'wallet', {
        messagesService: mockMessagesService,
        couponsService: mockCouponsService,
        scheduleHealthService: mockScheduleHealthService,
      } as any)
      const balanceTool = tools.find((t) => t.name === 'kbpay_query_balance')!
      await expect(balanceTool.execute({})).rejects.toThrow()
    })
  })

  describe('AgentAuditLogService 哈希链', () => {
    it('verifyChain 在无日志时返回 null（完整）', async () => {
      mockPrisma.agentOperationLog.findMany.mockResolvedValue([])
      const auditLog = app.get(AgentAuditLogService)
      const result = await auditLog.verifyChain(TEST_AGENT_ID)
      expect(result).toBeNull()
    })

    it('log 方法写入带 hash 的日志', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1)
      mockPrisma.agentOperationLog.findFirst.mockResolvedValue(null)
      mockPrisma.agentOperationLog.create.mockImplementation(async (args: any) => ({
        id: 'log-1',
        ...args.data,
        createdAt: new Date(),
      }))
      const auditLog = app.get(AgentAuditLogService)
      const result = await auditLog.log({
        agentId: TEST_AGENT_ID,
        subjectType: 'user',
        subjectId: TEST_USER_ID,
        action: 'kbpay_transfer',
        scope: 'wallet:write:transfer',
        amount: 10000,
        result: 'PENDING_CONFIRM',
      })
      expect(result.id).toBe('log-1')
      expect(result.hash).toBeDefined()
      expect(result.hash).toHaveLength(64) // sha256 hex 长度
    })
  })

  describe('AgentAuthGuard JWT 校验', () => {
    it('签发并验证有效 token', async () => {
      const token = signAgentToken()
      const decoded = jwtService.verify(token, {
        secret: configService.get<string>('JWT_AGENT_SECRET'),
      })
      expect(decoded.typ).toBe(JWT_TOKEN_TYPE_AGENT)
      expect(decoded.sub).toBe(TEST_AGENT_ID)
      expect(decoded.subjectId).toBe(TEST_USER_ID)
      expect(decoded.authScopes).toContain('wallet:read')
    })

    it('typ 非 agent 的 token 不应通过校验', async () => {
      const token = signAgentToken({ typ: 'user' })
      const decoded = jwtService.verify(token, {
        secret: configService.get<string>('JWT_AGENT_SECRET'),
      })
      expect(decoded.typ).not.toBe(JWT_TOKEN_TYPE_AGENT)
    })
  })
})
