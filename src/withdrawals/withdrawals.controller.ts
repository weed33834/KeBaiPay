import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { WithdrawalsService } from './withdrawals.service'
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto'

@ApiTags('提现')
@ApiBearerAuth('user-auth')
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '申请提现', description: '将钱包余额提现到绑定账户' })
  @ApiResponse({ status: 201, description: '提现订单创建成功，等待审核' })
  @ApiResponse({ status: 400, description: 'KB506 提现金额无效 / KB005 余额不足' })
  @ApiResponse({ status: 403, description: 'KB212 请先完成实名认证' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateWithdrawalDto) {
    return this.withdrawalsService.create(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '查询提现记录', description: '获取当前用户的提现订单列表' })
  @ApiResponse({ status: 200, description: '返回提现记录列表' })
  findByUser(@CurrentUser() user: CurrentUserType) {
    return this.withdrawalsService.findByUser(user.id)
  }
}
