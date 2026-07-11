import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { User } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { AccountsService } from './accounts.service'
import { AccountWithLedgers } from './dto/account-response.dto'
import { fenToYuan } from '../common/helpers'

@ApiTags('账户')
@ApiBearerAuth('user-auth')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: '获取当前用户账户信息', description: '返回余额及资金流水明细' })
  @ApiResponse({ status: 200, description: '返回账户信息（余额单位：元）' })
  @ApiResponse({ status: 401, description: '未登录或 Token 过期' })
  async me(@CurrentUser() user: Pick<User, 'id'>) {
    const account = (await this.accountsService.findByUserId(user.id)) as AccountWithLedgers | null
    if (!account) return null
    const { availableBalance, frozenBalance, totalBalance, ledgers, ...rest } = account
    return {
      ...rest,
      availableBalanceYuan: fenToYuan(availableBalance || 0),
      frozenBalanceYuan: fenToYuan(frozenBalance || 0),
      totalBalanceYuan: fenToYuan(totalBalance || 0),
      ledgers: (ledgers || []).map((l) => ({
        ...l,
        amountYuan: fenToYuan(l.amount),
        balanceBeforeYuan: fenToYuan(l.balanceBefore),
        balanceAfterYuan: fenToYuan(l.balanceAfter),
      })),
    }
  }
}
