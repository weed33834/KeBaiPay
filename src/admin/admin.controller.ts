import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Request } from 'express'
import { MerchantStatus } from '../common/enums'
import { AdminService, type AuditMeta } from './admin.service'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'
import { RequirePermissions } from './permissions.decorator'
import { AdminCurrentUser } from './admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from './admin-current-user.interface'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { MerchantsService } from '../merchants/merchants.service'
import { ListUsersQueryDto } from './dto/list-users-query.dto'
import { UpdateUserStatusDto } from './dto/update-user-status.dto'
import { UpdateUserRiskLevelDto } from './dto/update-user-risk-level.dto'
import { ListMerchantsQueryDto } from './dto/list-merchants-query.dto'
import { ListWithdrawalsQueryDto } from './dto/list-withdrawals-query.dto'
import { ListPaymentOrdersQueryDto } from './dto/list-payment-orders-query.dto'
import { ListRiskEventsQueryDto } from './dto/list-risk-events-query.dto'
import { ListLoginLogsQueryDto } from './dto/list-login-logs-query.dto'
import { SetSystemConfigDto } from './dto/set-system-config.dto'
import { UpdateRiskRuleDto } from './dto/update-risk-rule.dto'
import { AuditMerchantDto } from './dto/audit-merchant.dto'
import { UpdateMerchantConfigDto } from './dto/update-merchant-config.dto'
import { AdjustAccountDto } from './dto/adjust-account.dto'
import { RejectIdentityDto } from './dto/reject-identity.dto'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto'
import { ListPendingIdentitiesQueryDto } from './dto/list-pending-identities-query.dto'
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto'

@ApiTags('管理后台')
@ApiBearerAuth('user-auth')
@Controller('admin')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly merchantsService: MerchantsService,
  ) {}

  private extractAuditMeta(req: Request): AuditMeta {
    const userAgent = req.headers['user-agent']
    return {
      ip: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    }
  }

  @Get('dashboard')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '管理后台数据概览' })
  @ApiResponse({ status: 200, description: '返回统计数据' })
  getDashboardStats() {
    return this.adminService.getDashboardStats()
  }

  @Get('users')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '用户列表', description: '分页查询所有用户' })
  @ApiResponse({ status: 200, description: '返回用户列表' })
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.listUsers(query)
  }

  @Get('users/:id')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '用户详情' })
  @ApiResponse({ status: 200, description: '返回用户详情' })
  getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id)
  }

  @Post('users/:id/status')
  @RequirePermissions('user:status')
  @ApiOperation({ summary: '修改用户状态', description: '冻结/解冻用户账号' })
  @ApiResponse({ status: 200, description: '状态更新成功' })
  updateUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.updateUserStatus(
      id,
      dto.status,
      dto.reason,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Post('users/:id/risk-level')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '修改用户风控等级' })
  @ApiResponse({ status: 200, description: '风控等级更新成功' })
  updateUserRiskLevel(
    @Param('id') id: string,
    @Body() dto: UpdateUserRiskLevelDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.updateUserRiskLevel(
      id,
      dto.level,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Get('merchants')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '商户列表', description: '分页查询所有商户' })
  @ApiResponse({ status: 200, description: '返回商户列表' })
  listMerchants(@Query() query: ListMerchantsQueryDto) {
    return this.adminService.listMerchants(query)
  }

  @Post('merchants/:id/audit')
  @RequirePermissions('merchant:audit')
  @ApiOperation({ summary: '审核商户', description: '通过或拒绝商户入驻申请' })
  @ApiResponse({ status: 200, description: '审核完成' })
  async auditMerchant(
    @Param('id') id: string,
    @Body() dto: AuditMerchantDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    if (dto.action === 'REJECT' && !dto.reason) {
      throw new BadRequestException(kbError(KBErrorCodes.REJECT_REASON_REQUIRED))
    }
    const status =
      dto.action === 'APPROVE'
        ? MerchantStatus.APPROVED
        : MerchantStatus.REJECTED
    const result = await this.merchantsService.auditMerchant(
      id,
      { status, rejectReason: dto.reason },
      admin.sub,
    )
    await this.adminService.logAction(
      admin.sub,
      'MERCHANT_AUDIT',
      id,
      { action: dto.action, reason: dto.reason },
      this.extractAuditMeta(req),
    )
    return result
  }

  @Post('merchants/:id/config')
  @RequirePermissions('merchant:audit')
  @ApiOperation({ summary: '修改商户配置', description: '修改费率、日限额等商户配置' })
  @ApiResponse({ status: 200, description: '配置更新成功' })
  async updateMerchantConfig(
    @Param('id') id: string,
    @Body() dto: UpdateMerchantConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    const result = await this.merchantsService.updateMerchantConfig(id, dto)
    await this.adminService.logAction(
      admin.sub,
      'MERCHANT_CONFIG_UPDATE',
      id,
      dto,
      this.extractAuditMeta(req),
    )
    return result
  }

  @Get('withdrawals')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '提现审核列表' })
  @ApiResponse({ status: 200, description: '返回提现订单列表' })
  listWithdrawals(@Query() query: ListWithdrawalsQueryDto) {
    return this.adminService.listWithdrawals(query)
  }

  @Post('withdrawals/:id/approve')
  @RequirePermissions('withdrawal:audit')
  @ApiOperation({ summary: '通过提现申请' })
  @ApiResponse({ status: 200, description: '审核通过，资金已打款' })
  async approveWithdrawal(
    @Param('id') id: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    const result = await this.withdrawalsService.approve(id, admin.sub)
    await this.adminService.logAction(
      admin.sub,
      'WITHDRAWAL_AUDIT',
      id,
      { action: 'APPROVE' },
      this.extractAuditMeta(req),
    )
    return result
  }

  @Post('withdrawals/:id/reject')
  @RequirePermissions('withdrawal:audit')
  @ApiOperation({ summary: '拒绝提现申请' })
  @ApiResponse({ status: 200, description: '已拒绝，资金退回余额' })
  async rejectWithdrawal(
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    const result = await this.withdrawalsService.reject(id, admin.sub, dto.reason)
    await this.adminService.logAction(
      admin.sub,
      'WITHDRAWAL_AUDIT',
      id,
      { action: 'REJECT', reason: dto.reason },
      this.extractAuditMeta(req),
    )
    return result
  }

  @Get('payment-orders')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '支付订单列表' })
  @ApiResponse({ status: 200, description: '返回支付订单列表' })
  listPaymentOrders(@Query() query: ListPaymentOrdersQueryDto) {
    return this.adminService.listPaymentOrders(query)
  }

  @Get('risk-events')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '风控事件列表' })
  @ApiResponse({ status: 200, description: '返回风控事件列表' })
  listRiskEvents(@Query() query: ListRiskEventsQueryDto) {
    return this.adminService.listRiskEvents(query)
  }

  @Post('risk-events/:id/handle')
  @RequirePermissions('risk:event:handle')
  @ApiOperation({ summary: '处理风控事件' })
  @ApiResponse({ status: 200, description: '事件已处理' })
  handleRiskEvent(
    @Param('id') id: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.handleRiskEvent(
      id,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Get('login-logs')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '登录日志' })
  @ApiResponse({ status: 200, description: '返回登录日志列表' })
  listLoginLogs(@Query() query: ListLoginLogsQueryDto) {
    return this.adminService.listLoginLogs(query)
  }

  @Get('system-configs')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '获取系统配置' })
  @ApiResponse({ status: 200, description: '返回系统配置列表' })
  getSystemConfigs() {
    return this.adminService.getSystemConfigs()
  }

  @Post('system-configs')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '设置系统配置' })
  @ApiResponse({ status: 200, description: '配置设置成功' })
  setSystemConfig(
    @Body() dto: SetSystemConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.setSystemConfig(
      dto.key,
      dto.value,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Get('risk-rules')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '获取风控规则' })
  @ApiResponse({ status: 200, description: '返回风控规则列表' })
  getRiskRules() {
    return this.adminService.getRiskRules()
  }

  @Put('risk-rules/:code')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '更新风控规则' })
  @ApiResponse({ status: 200, description: '规则更新成功' })
  updateRiskRule(
    @Param('code') code: string,
    @Body() dto: UpdateRiskRuleDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.updateRiskRule(
      code,
      dto,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Get('identity/pending')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '待审核实名列表' })
  @ApiResponse({ status: 200, description: '返回待审核实名列表' })
  listPendingIdentities(@Query() query: ListPendingIdentitiesQueryDto) {
    return this.adminService.listPendingIdentities(query)
  }

  @Post('identity/:id/approve')
  @RequirePermissions('identity:audit')
  @ApiOperation({ summary: '通过实名认证' })
  @ApiResponse({ status: 200, description: '认证通过' })
  approveIdentity(
    @Param('id') id: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.approveIdentity(
      id,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Post('identity/:id/reject')
  @RequirePermissions('identity:audit')
  @ApiOperation({ summary: '拒绝实名认证' })
  @ApiResponse({ status: 200, description: '已拒绝' })
  rejectIdentity(
    @Param('id') id: string,
    @Body() dto: RejectIdentityDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.rejectIdentity(
      id,
      dto.reason,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Post('accounts/:userId/adjust')
  @RequirePermissions('account:adjust')
  @ApiOperation({ summary: '人工调账', description: '管理员手动调整用户账户余额' })
  @ApiResponse({ status: 200, description: '调账成功' })
  adjustAccount(
    @Param('userId') userId: string,
    @Body() dto: AdjustAccountDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.adjustAccount(
      userId,
      dto.amount,
      dto.reason,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Get('audit-logs')
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '操作审计日志' })
  @ApiResponse({ status: 200, description: '返回审计日志列表' })
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.adminService.listAuditLogs(query)
  }
}
