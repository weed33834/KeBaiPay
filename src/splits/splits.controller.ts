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
import { SplitsService } from './splits.service'
import { CreateSplitDto } from './dto/create-split.dto'
import { ListSplitDto } from './dto/list-split.dto'

@ApiTags('分账 Split')
@ApiBearerAuth('user-auth')
@Controller('splits')
export class SplitsController {
  constructor(private readonly splitsService: SplitsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({
    summary: '发起分账',
    description: '把一笔已支付订单的金额按比例/固定金额分给多个接收方',
  })
  @ApiResponse({ status: 201, description: '分账创建成功' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateSplitDto) {
    return this.splitsService.createSplit(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':splitNo')
  @ApiOperation({ summary: '查询分账订单详情' })
  findBySplitNo(
    @CurrentUser() user: CurrentUserType,
    @Param('splitNo') splitNo: string,
  ) {
    return this.splitsService.findBySplitNo(user.id, splitNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '列出我的分账订单' })
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListSplitDto,
  ) {
    return this.splitsService.list(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':splitNo/cancel')
  @ApiOperation({ summary: '取消分账订单', description: '仅 PENDING 状态可取消' })
  cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('splitNo') splitNo: string,
  ) {
    return this.splitsService.cancel(user.id, splitNo)
  }
}
