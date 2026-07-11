import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { User } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { UsersService } from './users.service'
import { VerifyIdentityDto } from './dto/verify-identity.dto'
import { ResetPayPasswordDto } from './dto/reset-pay-password.dto'

@ApiTags('用户')
@ApiBearerAuth('user-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: '获取当前用户信息' })
  @ApiResponse({ status: 200, description: '返回用户安全资料（不含密码）' })
  async me(@CurrentUser() user: Pick<User, 'id'>) {
    return this.usersService.getSafeProfile(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-identity')
  @ApiOperation({ summary: '提交实名认证', description: '提交身份证姓名+号码进行实名验证' })
  @ApiResponse({ status: 201, description: '提交成功，进入审核' })
  @ApiResponse({ status: 400, description: 'KB202 已实名 / KB203 审核中' })
  verifyIdentity(@CurrentUser() user: Pick<User, 'id'>, @Body() dto: VerifyIdentityDto) {
    return this.usersService.verifyIdentity(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('reset-pay-password')
  @ApiOperation({ summary: '重置支付密码', description: '验证旧支付密码后设置新密码' })
  @ApiResponse({ status: 200, description: '重置成功' })
  @ApiResponse({ status: 400, description: 'KB208 支付密码错误' })
  resetPayPassword(@CurrentUser() user: Pick<User, 'id'>, @Body() dto: ResetPayPasswordDto) {
    return this.usersService.resetPayPassword(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('daily-limit')
  @ApiOperation({ summary: '查询当日限额使用情况' })
  @ApiResponse({ status: 200, description: '返回当日已用/总额度' })
  getDailyLimit(@CurrentUser() user: Pick<User, 'id'>) {
    return this.usersService.getDailyLimit(user.id)
  }
}
