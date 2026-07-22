import {
  Body,
  Controller,
  Get,
  Patch,
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
import { ChangePasswordDto } from './dto/change-password.dto'
import { BindPhoneDto } from './dto/bind-phone.dto'
import { BindEmailDto } from './dto/bind-email.dto'

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
  @Patch('me')
  @ApiOperation({ summary: '更新当前用户资料', description: '更新昵称、头像等基础信息' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateMe(@CurrentUser() user: Pick<User, 'id'>, @Body() dto: { nickname?: string; avatar?: string }) {
    return this.usersService.updateProfile(user.id, dto)
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
  @Post('change-password')
  @ApiOperation({ summary: '修改登录密码', description: '验证原登录密码后设置新密码' })
  @ApiResponse({ status: 200, description: '修改成功' })
  @ApiResponse({ status: 401, description: 'KB221 原登录密码错误' })
  changePassword(@CurrentUser() user: Pick<User, 'id'>, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeLoginPassword(user.id, dto.oldPassword, dto.newPassword)
  }

  @UseGuards(JwtAuthGuard)
  @Post('bind-phone')
  @ApiOperation({ summary: '绑定/换绑手机号', description: '校验短信验证码后更新用户手机号' })
  @ApiResponse({ status: 200, description: '绑定成功' })
  @ApiResponse({ status: 400, description: 'KB224 验证码错误 / KB222 手机号已被绑定' })
  bindPhone(@CurrentUser() user: Pick<User, 'id'>, @Body() dto: BindPhoneDto) {
    return this.usersService.bindPhone(user.id, dto.phone, dto.code)
  }

  @UseGuards(JwtAuthGuard)
  @Post('bind-email')
  @ApiOperation({ summary: '绑定/换绑邮箱', description: '校验验证码后更新用户邮箱' })
  @ApiResponse({ status: 200, description: '绑定成功' })
  @ApiResponse({ status: 400, description: 'KB224 验证码错误 / KB223 邮箱已被绑定' })
  bindEmail(@CurrentUser() user: Pick<User, 'id'>, @Body() dto: BindEmailDto) {
    return this.usersService.bindEmail(user.id, dto.email, dto.code)
  }

  @UseGuards(JwtAuthGuard)
  @Get('login-logs')
  @ApiOperation({ summary: '查询登录日志', description: '获取当前用户最近 30 天登录记录' })
  @ApiResponse({ status: 200, description: '返回登录日志列表' })
  loginLogs(@CurrentUser() user: Pick<User, 'id'>) {
    return this.usersService.getLoginLogs(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('daily-limit')
  @ApiOperation({ summary: '查询当日限额使用情况' })
  @ApiResponse({ status: 200, description: '返回当日已用/总额度' })
  getDailyLimit(@CurrentUser() user: Pick<User, 'id'>) {
    return this.usersService.getDailyLimit(user.id)
  }
}
