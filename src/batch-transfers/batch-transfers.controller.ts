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
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { BatchTransfersService } from './batch-transfers.service'
import { CreateBatchTransferDto } from './dto/create-batch-transfer.dto'
import { ListBatchTransferDto } from './dto/list-batch-transfer.dto'

@ApiTags('批量转账')
@ApiBearerAuth('user-auth')
@Controller('batch-transfers')
export class BatchTransfersController {
  constructor(private readonly batchTransfersService: BatchTransfersService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '提交批量转账', description: '一次性向多个收款方转账，原子提交、逐笔处理' })
  @ApiResponse({ status: 201, description: '批次已提交，逐笔处理完成后返回最终状态' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateBatchTransferDto) {
    return this.batchTransfersService.createBatch(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':batchNo')
  @ApiOperation({ summary: '查询批次详情', description: '返回批次基本信息 + 全部明细列表' })
  findByBatchNo(
    @CurrentUser() user: CurrentUserType,
    @Param('batchNo') batchNo: string,
  ) {
    return this.batchTransfersService.findByBatchNo(user.id, batchNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '列出我的批次', description: '可按 status 过滤，分页' })
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListBatchTransferDto,
  ) {
    return this.batchTransfersService.list(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':batchNo/cancel')
  @ApiOperation({ summary: '取消批次', description: '仅 PENDING/PROCESSING 状态可取消；已 SUCCESS 明细不退回' })
  cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('batchNo') batchNo: string,
  ) {
    return this.batchTransfersService.cancel(user.id, batchNo)
  }
}
