import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentAuthGuard } from './agent-auth.guard'
import { AgentService } from './agent.service'
import { AgentAuthService } from './agent-auth.service'
import { AgentAuditLogService } from './agent-audit-log.service'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AgentCurrentUser } from './agent-current-user.interface'
import {
  CreateAgentDto, UpdateAgentDto, AuthorizeAgentDto,
  StartConversationDto, SendMessageDto, ConfirmOpDto,
} from './dto/agent.dto'

/**
 * Agent 智能体 HTTP 端点
 *
 * 端点分组：
 *  1. /agent/me/agents       - 用户授权管理
 *  2. /agent/authorize       - 用户授权 Agent
 *  3. /agent/login           - 换取 Agent token
 *  4. /agent/conversations   - 会话管理
 *  5. /agent/chat            - 发送消息（核心入口）
 *  6. /agent/confirm         - 确认/拒绝待确认操作
 *  7. /agent/verify-chain    - 校验操作哈希链
 */
@ApiTags('AI 智能体')
@ApiBearerAuth('agent-auth')
@UseGuards(AgentAuthGuard)
@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly agentAuthService: AgentAuthService,
    private readonly auditLog: AgentAuditLogService,
  ) {}

  @Post('conversations')
  @ApiOperation({ summary: '创建会话' })
  async createConversation(
    @CurrentUser() user: AgentCurrentUser,
    @Body() dto: StartConversationDto,
  ) {
    return this.agentService.createConversation(
      user.subjectId!, dto.scenario, dto.title, dto.metadata,
    )
  }

  @Get('conversations')
  @ApiOperation({ summary: '查询我的会话列表' })
  async listConversations(
    @CurrentUser() user: AgentCurrentUser,
    @Query('scenario') scenario?: string,
  ) {
    return this.agentService.listConversations(user.subjectId!, scenario)
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '查询会话历史消息' })
  async listMessages(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return this.agentService.listMessages(id, limit)
  }

  @Post('conversations/:id/close')
  @ApiOperation({ summary: '关闭会话' })
  async closeConversation(
    @Param('id') id: string,
    @Body('summary') summary?: string,
  ) {
    return this.agentService.closeConversation(id, summary)
  }

  @Post('chat')
  @ApiOperation({ summary: '发送消息并获取 AI 回复（核心入口）' })
  async chat(
    @CurrentUser() user: AgentCurrentUser,
    @Body() dto: SendMessageDto,
  ) {
    if (!dto.convId) {
      throw new BadRequestException('convId 不能为空')
    }
    return this.agentService.sendMessage({
      convId: dto.convId,
      content: dto.content,
      user,
    })
  }

  @Post('confirm')
  @ApiOperation({ summary: '确认或拒绝待确认的操作（资金类）' })
  async confirmOp(
    @CurrentUser() user: AgentCurrentUser,
    @Body() dto: ConfirmOpDto,
  ) {
    return this.agentService.confirmOp({
      opLogId: dto.opLogId,
      decision: dto.decision,
      user,
    })
  }

  @Get('verify-chain/:agentId')
  @ApiOperation({ summary: '校验 Agent 操作哈希链（防篡改）' })
  async verifyChain(@Param('agentId') agentId: string) {
    return this.agentService.verifyHashChain(agentId)
  }

  /** ===== 以下端点需要主体授权管理权限（用户自己操作） ===== */

  @Post('authorize')
  @ApiOperation({ summary: '用户授权 Agent 代为操作' })
  async authorize(@Body() dto: AuthorizeAgentDto) {
    return this.agentAuthService.authorize({
      agentId: dto.agentId,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      scopes: dto.scopes,
      maxAmount: dto.maxAmount,
      expiresAt: dto.expiresAt,
    })
  }

  @Post('revoke/:authId')
  @ApiOperation({ summary: '撤销授权' })
  async revoke(@Param('authId') authId: string) {
    return this.agentAuthService.revoke(authId)
  }

  @Get('authorizations')
  @ApiOperation({ summary: '查询我的授权列表' })
  async listAuthorizations(@CurrentUser() user: AgentCurrentUser) {
    return this.agentAuthService.listMyAuthorizations(user.subjectId!)
  }
}
