import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { FinanceService } from './finance.service'
import { DateRangeQueryDto } from './dto/date-range-query.dto'
import { MerchantSettlementsQueryDto } from './dto/merchant-settlements-query.dto'
import { OverviewQueryDto } from './dto/overview-query.dto'
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto'

@ApiTags('财务')
@ApiBearerAuth('user-auth')
@Controller('admin/finance')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('overview')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '财务概览', description: '查询平台整体财务数据' })
  @ApiResponse({ status: 200, description: '返回财务概览' })
  getOverview(@Query() query: OverviewQueryDto) {
    return this.financeService.getOverview(query)
  }

  @Get('daily-summary')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '每日收支汇总' })
  @ApiResponse({ status: 200, description: '返回每日汇总数据' })
  getDailySummary(@Query() query: DateRangeQueryDto) {
    return this.financeService.getDailySummary(query)
  }

  @Get('daily-summary/export')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '导出每日汇总 CSV' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportDailySummary(
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportDailySummary(query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="daily-summary.csv"',
    )
    res.send(csv)
  }

  @Get('merchant-settlements')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '商户结算明细' })
  @ApiResponse({ status: 200, description: '返回结算数据' })
  getMerchantSettlements(@Query() query: MerchantSettlementsQueryDto) {
    return this.financeService.getMerchantSettlements(query)
  }

  @Get('merchant-settlements/export')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '导出商户结算 CSV' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportMerchantSettlements(
    @Query() query: MerchantSettlementsQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportMerchantSettlements(query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="merchant-settlements.csv"',
    )
    res.send(csv)
  }

  @Get('fee-income')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '手续费收入统计' })
  @ApiResponse({ status: 200, description: '返回手续费数据' })
  getFeeIncome(@Query() query: DateRangeQueryDto) {
    return this.financeService.getFeeIncome(query)
  }

  @Get('fee-income/export')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '导出手续费 CSV' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportFeeIncome(
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportFeeIncome(query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fee-income.csv"',
    )
    res.send(csv)
  }

  @Get('daily-snapshots')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '每日资产快照' })
  @ApiResponse({ status: 200, description: '返回快照数据' })
  getDailySnapshots(@Query() query: DateRangeQueryDto) {
    return this.financeService.getDailySnapshots(query)
  }

  @Get('snapshots/export')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '导出资产快照 CSV' })
  @ApiResponse({ status: 200, description: 'CSV 文件下载' })
  async exportSnapshots(
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportDailySnapshots(query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="daily-snapshots.csv"',
    )
    res.send(csv)
  }

  @Post('snapshots/generate')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '手动生成每日快照' })
  @ApiResponse({ status: 201, description: '快照生成成功' })
  generateSnapshot(@Body() dto: GenerateSnapshotDto) {
    return this.financeService.generateDailySnapshot(dto.date)
  }

  @Get('settlement/unfinished')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '未结算订单汇总' })
  @ApiResponse({ status: 200, description: '返回未结算数据' })
  getUnsettledSummary() {
    return this.financeService.getUnsettledSummary()
  }

  @Post('settlement/run')
  @RequirePermissions('reconciliation:run')
  @ApiOperation({ summary: '手动执行结算' })
  @ApiResponse({ status: 200, description: '结算执行成功' })
  runSettlement() {
    return this.financeService.runManualSettlement()
  }
}
