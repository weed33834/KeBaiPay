import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { AdminCurrentUser } from '../admin/admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from '../admin/admin-current-user.interface'
import { ChannelReconciliationService } from './channel-reconciliation.service'
import {
  AssignDifferenceDto,
  FetchStatementDto,
  ListDifferencesQueryDto,
  ListStatementItemsQueryDto,
  ListStatementsQueryDto,
  ResolveDifferenceDto,
} from './dto/channel-reconciliation.dto'

/**
 * S5 多平台对账聚合 - 管理端接口
 *
 * 路由前缀：/admin/channel-reconciliation
 * 权限：FINANCE 角色可读可操作；SUPER_ADMIN 全权限
 */
@ApiTags('多平台对账聚合')
@ApiBearerAuth('user-auth')
@Controller('admin/channel-reconciliation')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ChannelReconciliationController {
  constructor(
    private readonly service: ChannelReconciliationService,
  ) {}

  // ============== 渠道对账单 ==============

  @Post('statements/fetch')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '拉取渠道对账单', description: '从指定渠道拉取当日对账单（mock：从平台订单生成）' })
  @ApiResponse({ status: 201, description: '拉取成功' })
  @ApiResponse({ status: 400, description: 'KB941 已拉取 / KB942 拉取失败' })
  fetchStatement(
    @Body() dto: FetchStatementDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.service.fetchStatement(dto, admin?.sub)
  }

  @Get('statements')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '渠道对账单列表' })
  listStatements(@Query() query: ListStatementsQueryDto) {
    return this.service.listStatements(query)
  }

  @Get('statements/:id')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '对账单详情（含前 50 条 items）' })
  getStatement(@Param('id') id: string) {
    return this.service.getStatement(id)
  }

  @Get('statements/:id/items')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '对账单条目分页查询' })
  listStatementItems(
    @Param('id') id: string,
    @Query() query: ListStatementItemsQueryDto,
  ) {
    return this.service.listStatementItems(id, query)
  }

  @Post('statements/:id/match')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '执行匹配', description: '将渠道流水与平台订单交叉匹配并生成差异项' })
  @ApiResponse({ status: 201, description: '匹配完成，返回差异统计' })
  matchStatement(@Param('id') id: string) {
    return this.service.matchStatement(id)
  }

  // ============== 差异处理工作流 ==============

  @Get('differences')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '差异项列表' })
  listDifferences(@Query() query: ListDifferencesQueryDto) {
    return this.service.listDifferences(query)
  }

  @Get('differences/:id')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '差异项详情' })
  getDifference(@Param('id') id: string) {
    return this.service.getDifference(id)
  }

  @Post('differences/:id/assign')
  @RequirePermissions('reconciliation:diff:handle')
  @ApiOperation({ summary: '指派差异处理人', description: 'PENDING → INVESTIGATING' })
  @ApiResponse({ status: 201, description: '指派成功' })
  @ApiResponse({ status: 400, description: 'KB945 状态不允许' })
  assignDifference(
    @Param('id') id: string,
    @Body() dto: AssignDifferenceDto,
  ) {
    return this.service.assignDifference(id, dto)
  }

  @Post('differences/:id/resolve')
  @RequirePermissions('reconciliation:diff:handle')
  @ApiOperation({ summary: '标记差异已解决', description: 'INVESTIGATING → RESOLVED / IGNORED' })
  @ApiResponse({ status: 201, description: '解决成功' })
  @ApiResponse({ status: 400, description: 'KB945 状态不允许' })
  resolveDifference(
    @Param('id') id: string,
    @Body() dto: ResolveDifferenceDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.service.resolveDifference(id, dto, admin?.sub)
  }
}
