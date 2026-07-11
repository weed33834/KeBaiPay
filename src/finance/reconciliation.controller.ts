import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { AdminCurrentUser } from '../admin/admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from '../admin/admin-current-user.interface'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { ReconciliationService } from './reconciliation.service'
import { RunReconciliationDto } from './dto/run-reconciliation.dto'
import { ReportsQueryDto } from './dto/reports-query.dto'

@ApiTags('财务')
@ApiBearerAuth('user-auth')
@Controller('admin/reconciliation')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('run')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '执行对账', description: '对指定日期进行对账' })
  @ApiResponse({ status: 201, description: '对账完成' })
  runReconciliation(
    @Body() dto: RunReconciliationDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.reconciliationService.runReconciliation(dto.date, admin?.sub)
  }

  @Get('reports')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '对账报告列表' })
  @ApiResponse({ status: 200, description: '返回对账报告列表' })
  getReports(@Query() query: ReportsQueryDto) {
    return this.reconciliationService.getReports(query)
  }

  @Get('reports/export')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '导出对账报告 CSV' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportReports(
    @Query() query: ReportsQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.reconciliationService.exportReports(query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="reconciliation-reports.csv"',
    )
    res.send(csv)
  }

  @Get('reports/:date')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '查询指定日期对账报告' })
  @ApiResponse({ status: 200, description: '返回对账报告详情' })
  getReport(@Param('date') date: string) {
    return this.reconciliationService.getReport(date)
  }
}
