import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { RiskAuditService } from './risk-audit.service'
import {
  CreateRiskAuditSessionDto,
  SendMessageDto,
  CloseSessionDto,
  ListRiskAuditSessionDto,
} from './dto/risk-audit.dto'

@ApiTags('AI 风控审计')
@ApiBearerAuth('user-auth')
@Controller()
export class RiskAuditController {
  constructor(private readonly riskAuditService: RiskAuditService) {}

  // ============== 用户端 ==============

  @UseGuards(JwtAuthGuard)
  @Post('risk-audit/sessions')
  @ApiOperation({ summary: '创建风控审计会话' })
  async createSession(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateRiskAuditSessionDto,
  ) {
    return this.riskAuditService.createSession(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('risk-audit/sessions')
  @ApiOperation({ summary: '查询我的会话列表' })
  async listMySessions(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListRiskAuditSessionDto,
  ) {
    return this.riskAuditService.listMySessions(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get('risk-audit/sessions/:sessionNo')
  @ApiOperation({ summary: '查询会话详情（含消息）' })
  async findBySessionNo(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionNo') sessionNo: string,
  ) {
    return this.riskAuditService.findBySessionNo(sessionNo, user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('risk-audit/sessions/:sessionNo/messages')
  @ApiOperation({ summary: '发送消息并获取 AI 回复' })
  async sendMessage(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionNo') sessionNo: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.riskAuditService.sendMessage(user.id, sessionNo, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('risk-audit/sessions/:sessionNo/close')
  @ApiOperation({ summary: '关闭会话' })
  async closeSession(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionNo') sessionNo: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.riskAuditService.closeSession(user.id, sessionNo, dto)
  }

  // ============== 管理端 ==============

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/risk-audit/sessions')
  @ApiOperation({ summary: '管理员查询所有会话' })
  async adminList(@Query() query: ListRiskAuditSessionDto) {
    return this.riskAuditService.listAllSessions(query)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/risk-audit/sessions/:sessionNo')
  @ApiOperation({ summary: '管理员查询任意会话详情' })
  async adminFindBySessionNo(@Param('sessionNo') sessionNo: string) {
    return this.riskAuditService.findBySessionNo(sessionNo)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/risk-audit/stats')
  @ApiOperation({ summary: '管理员查询会话统计' })
  async adminGetStats() {
    return this.riskAuditService.getStats()
  }
}
