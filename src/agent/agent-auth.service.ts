import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { kbError, KBErrorCodes } from '../common/error-codes'
import {
  JWT_TOKEN_TYPE_AGENT,
  AGENT_SCENARIOS,
  type AgentScenario,
} from '../common/constants'
import { generateOrderNo, generateAppSecret } from '../common/helpers'
import type { AgentCurrentUser } from './agent-current-user.interface'

/**
 * Agent 认证服务：
 *  - createAgent：创建 Agent（管理端调用，分配 appSecret）
 *  - activate：用户/商户激活 Agent（创建 AgentAuthorization）
 *  - login：换取长期 JWT token（携带主体授权信息）
 *  - revoke：撤销授权
 */
@Injectable()
export class AgentAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** 创建 Agent（管理端调用） */
  async createAgent(input: {
    name: string
    description?: string
    scenario: string
    scopes?: string[]
  }) {
    if (!AGENT_SCENARIOS.includes(input.scenario as AgentScenario)) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_SCOPE_DENIED, '场景类型无效'))
    }
    const agent = await this.prisma.agent.create({
      data: {
        agentNo: generateOrderNo('AGT'),
        name: input.name,
        description: input.description,
        appSecret: generateAppSecret(),
        status: 'ACTIVE',
        scopes: JSON.stringify(input.scopes ?? []),
        scenario: input.scenario,
        version: '1.0.0',
      },
    })
    return agent
  }

  /** 用户/商户授权某个 Agent 代为操作 */
  async authorize(input: {
    agentId: string
    subjectType: 'user' | 'merchant'
    subjectId: string
    scopes: string[]
    maxAmount?: number
    expiresAt?: Date
  }) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: input.agentId },
    })
    if (!agent) throw new NotFoundException(kbError(KBErrorCodes.AGENT_NOT_FOUND))
    if (agent.status !== 'ACTIVE') {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_DISABLED))
    }

    // 校验申请的 scopes 必须是 Agent 自身 scopes 的子集
    const agentScopes: string[] = JSON.parse(agent.scopes || '[]')
    const invalidScopes = input.scopes.filter((s) => !agentScopes.includes(s))
    if (invalidScopes.length > 0) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AGENT_SCOPE_DENIED, `超出 Agent 授权范围: ${invalidScopes.join(',')}`),
      )
    }

    return this.prisma.agentAuthorization.create({
      data: {
        agentId: input.agentId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        scopes: JSON.stringify(input.scopes),
        maxAmount: input.maxAmount ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    })
  }

  /** 用户携带授权记录换取 Agent token（长期） */
  async login(input: {
    agentId: string
    authId: string
    subjectId: string
  }): Promise<{ token: string; expiresIn: string }> {
    const [agent, auth] = await Promise.all([
      this.prisma.agent.findUnique({ where: { id: input.agentId } }),
      this.prisma.agentAuthorization.findUnique({ where: { id: input.authId } }),
    ])
    if (!agent) throw new NotFoundException(kbError(KBErrorCodes.AGENT_NOT_FOUND))
    if (agent.status !== 'ACTIVE') {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_DISABLED))
    }
    if (!auth) throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
    if (auth.subjectId !== input.subjectId || auth.agentId !== input.agentId) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
    }
    if (auth.revokedAt) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_REVOKED))
    }
    if (auth.expiresAt && auth.expiresAt < new Date()) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_EXPIRED))
    }

    const expiresIn = this.configService.get<string>('JWT_AGENT_EXPIRES_IN', '7d')
    const token = this.jwtService.sign(
      {
        sub: agent.id,
        typ: JWT_TOKEN_TYPE_AGENT,
        scenario: agent.scenario,
        scopes: JSON.parse(agent.scopes || '[]'),
        subjectType: auth.subjectType,
        subjectId: auth.subjectId,
        authId: auth.id,
        authScopes: JSON.parse(auth.scopes || '[]'),
      },
      {
        secret: this.configService.get<string>('JWT_AGENT_SECRET'),
        expiresIn: expiresIn as any,
      },
    )
    return { token, expiresIn }
  }

  /** 撤销授权 */
  async revoke(authId: string) {
    const auth = await this.prisma.agentAuthorization.findUnique({
      where: { id: authId },
    })
    if (!auth) throw new NotFoundException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
    if (auth.revokedAt) return auth
    return this.prisma.agentAuthorization.update({
      where: { id: authId },
      data: { revokedAt: new Date() },
    })
  }

  /** 列出某个用户的授权 */
  async listMyAuthorizations(userId: string) {
    return this.prisma.agentAuthorization.findMany({
      where: { subjectId: userId, subjectType: 'user' },
      include: { agent: true },
      orderBy: { createdAt: 'desc' },
    })
  }
}
