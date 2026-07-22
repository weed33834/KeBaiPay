import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RiskAuditAiEngine } from './risk-audit-ai.engine'
import {
  RiskAuditSessionStatus,
  RiskAuditMessageRole,
} from '../common/enums'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { generateOrderNo } from '../common/helpers'
import {
  CreateRiskAuditSessionDto,
  SendMessageDto,
  CloseSessionDto,
  ListRiskAuditSessionDto,
} from './dto/risk-audit.dto'

/**
 * 风控审计会话服务
 *
 * 资金流：无
 * 业务流：
 *  1. 用户创建会话（ACTIVE）
 *  2. 用户发送消息 → AI 引擎识别意图 → 生成回复 → 持久化双方消息
 *  3. 用户关闭会话（CLOSED）+ 写入摘要
 */
@Injectable()
export class RiskAuditService {
  private readonly logger = new Logger(RiskAuditService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiEngine: RiskAuditAiEngine,
  ) {}

  /** 创建会话 */
  async createSession(userId: string, dto: CreateRiskAuditSessionDto) {
    const sessionNo = generateOrderNo('RAS')
    const session = await this.prisma.riskAuditSession.create({
      data: {
        sessionNo,
        userId,
        title: dto.title || '风控咨询会话',
        status: RiskAuditSessionStatus.ACTIVE,
      },
    })
    // 写入系统欢迎消息
    await this.prisma.riskAuditMessage.create({
      data: {
        sessionId: session.id,
        role: RiskAuditMessageRole.SYSTEM,
        content:
          '会话已创建。我是 KeBaiPay 风控助手，可以为您查询风控规则、解释风险事件、查询账户状态等。请直接描述您的问题。',
        intent: 'GREETING',
      },
    })
    return this.findBySessionNo(sessionNo, userId)
  }

  /** 列出我的会话 */
  async listMySessions(userId: string, query: ListRiskAuditSessionDto) {
    const where: any = { userId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))

    const [items, total] = await Promise.all([
      this.prisma.riskAuditSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.riskAuditSession.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 管理员列出所有会话 */
  async listAllSessions(query: ListRiskAuditSessionDto) {
    const where: any = {}
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))

    const [items, total] = await Promise.all([
      this.prisma.riskAuditSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: true },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.riskAuditSession.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 查询会话详情（含消息列表） */
  async findBySessionNo(sessionNo: string, userId?: string) {
    const session = await this.prisma.riskAuditSession.findUnique({
      where: { sessionNo },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        user: userId === undefined, // 管理员视角 include user
      },
    })
    if (!session) {
      throw new NotFoundException(kbError(KBErrorCodes.RISK_AUDIT_SESSION_NOT_FOUND))
    }
    // 用户视角权限校验
    if (userId && session.userId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.RISK_AUDIT_PERMISSION_DENIED))
    }
    return session
  }

  /** 发送消息并获取 AI 回复 */
  async sendMessage(userId: string, sessionNo: string, dto: SendMessageDto) {
    const content = dto.content?.trim()
    if (!content) {
      throw new BadRequestException(kbError(KBErrorCodes.RISK_AUDIT_MESSAGE_EMPTY))
    }

    // 查会话
    const session = await this.prisma.riskAuditSession.findUnique({
      where: { sessionNo },
    })
    if (!session) {
      throw new NotFoundException(kbError(KBErrorCodes.RISK_AUDIT_SESSION_NOT_FOUND))
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.RISK_AUDIT_PERMISSION_DENIED))
    }
    if (session.status !== RiskAuditSessionStatus.ACTIVE) {
      throw new BadRequestException(kbError(KBErrorCodes.RISK_AUDIT_SESSION_CLOSED))
    }

    // 调用 AI 引擎
    const aiResult = await this.aiEngine.handle(userId, content)

    // 持久化：用户消息 + AI 回复（同一事务）
    const [userMsg, aiMsg] = await this.prisma.$transaction([
      this.prisma.riskAuditMessage.create({
        data: {
          sessionId: session.id,
          role: RiskAuditMessageRole.USER,
          content,
        },
      }),
      this.prisma.riskAuditMessage.create({
        data: {
          sessionId: session.id,
          role: aiResult.role,
          content: aiResult.content,
          intent: aiResult.intent,
          metadata: aiResult.metadata ? JSON.stringify(aiResult.metadata) : null,
        },
      }),
    ])

    // 更新会话 updatedAt
    await this.prisma.riskAuditSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    })

    return {
      sessionNo,
      userMessage: userMsg,
      aiMessage: aiMsg,
      intent: aiResult.intent,
    }
  }

  /** 关闭会话 */
  async closeSession(userId: string, sessionNo: string, dto: CloseSessionDto) {
    const session = await this.prisma.riskAuditSession.findUnique({
      where: { sessionNo },
    })
    if (!session) {
      throw new NotFoundException(kbError(KBErrorCodes.RISK_AUDIT_SESSION_NOT_FOUND))
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.RISK_AUDIT_PERMISSION_DENIED))
    }
    if (session.status === RiskAuditSessionStatus.CLOSED) {
      throw new BadRequestException(kbError(KBErrorCodes.RISK_AUDIT_SESSION_CLOSED))
    }

    // 乐观锁：仅 ACTIVE → CLOSED
    const result = await this.prisma.riskAuditSession.updateMany({
      where: { id: session.id, status: RiskAuditSessionStatus.ACTIVE },
      data: {
        status: RiskAuditSessionStatus.CLOSED,
        summary: dto.summary || '用户主动关闭会话',
        closedAt: new Date(),
      },
    })
    if (result.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.RISK_AUDIT_SESSION_CLOSED))
    }
    return this.prisma.riskAuditSession.findUnique({ where: { id: session.id } })
  }

  /** 获取会话统计（管理员） */
  async getStats() {
    const [total, active, closed] = await Promise.all([
      this.prisma.riskAuditSession.count(),
      this.prisma.riskAuditSession.count({ where: { status: RiskAuditSessionStatus.ACTIVE } }),
      this.prisma.riskAuditSession.count({ where: { status: RiskAuditSessionStatus.CLOSED } }),
    ])
    const messageCount = await this.prisma.riskAuditMessage.count()
    return { totalSessions: total, activeSessions: active, closedSessions: closed, messageCount }
  }
}
