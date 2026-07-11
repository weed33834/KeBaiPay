import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { TransfersService } from './transfers.service'
import { TransferDto } from './dto/transfer.dto'

@ApiTags('转账')
@ApiBearerAuth('user-auth')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '用户间转账', description: '从当前用户账户向目标用户转账' })
  @ApiResponse({ status: 201, description: '转账成功' })
  @ApiResponse({ status: 400, description: 'KB501 金额无效 / KB502 不能给自己转账 / KB005 余额不足' })
  @ApiResponse({ status: 403, description: 'KB214 对方未实名 / 风控拦截' })
  transfer(@CurrentUser() user: CurrentUserType, @Body() dto: TransferDto) {
    return this.transfersService.transfer(user.id, dto)
  }
}
