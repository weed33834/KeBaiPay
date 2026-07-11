import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { TransactionsService } from './transactions.service'
import { RechargeDto } from './dto/recharge.dto'

@ApiTags('交易')
@ApiBearerAuth('user-auth')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('recharge')
  @ApiOperation({ summary: '账户充值', description: '通过支付渠道为钱包余额充值' })
  @ApiResponse({ status: 201, description: '充值订单创建成功' })
  @ApiResponse({ status: 400, description: 'KB503 充值金额无效 / KB504 无可用渠道' })
  @ApiResponse({ status: 403, description: 'KB003 超出单日限额' })
  recharge(@CurrentUser() user: CurrentUserType, @Body() dto: RechargeDto) {
    return this.transactionsService.recharge(
      user.id,
      dto.amount,
      dto.payPassword,
      dto.idempotencyKey,
    )
  }
}
