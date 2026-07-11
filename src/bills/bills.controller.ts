import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { User } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { BillsService } from './bills.service'
import { ListBillsQueryDto } from './dto/list-bills-query.dto'
import { fenToYuan } from '../common/helpers'

@ApiTags('账单')
@ApiBearerAuth('user-auth')
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '查询账单列表', description: '获取当前用户的收支账单' })
  @ApiQuery({ name: 'direction', required: false, enum: ['INCOME', 'EXPENSE'], description: '筛选收入/支出' })
  @ApiResponse({ status: 200, description: '返回账单列表（金额单位：元）' })
  async list(
    @CurrentUser() user: Pick<User, 'id'>,
    @Query() query: ListBillsQueryDto,
  ) {
    const bills = await this.billsService.findByUser(user.id, query.direction)
    return bills.map((b) => ({
      ...b,
      amountYuan: fenToYuan(b.amount),
    }))
  }
}
