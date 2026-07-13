import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Request } from 'express'
import { Throttle } from '@nestjs/throttler'
import { AdminAuthService } from './admin-auth.service'
import { AdminService } from './admin.service'
import { AdminLoginDto } from './dto/admin-login.dto'
import { ChangeAdminPasswordDto } from './dto/admin-user.dto'
import { AUTH_THROTTLE_LIMIT, AUTH_THROTTLE_TTL_MS } from '../common/constants'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { AdminCurrentUser } from './admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from './admin-current-user.interface'

@ApiTags('管理后台')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly adminService: AdminService,
  ) {}

  @Throttle({ default: { ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT } })
  @Post('login')
  @ApiOperation({ summary: '管理员登录', description: '使用用户名+密码登录管理后台' })
  @ApiResponse({ status: 200, description: '登录成功，返回管理员 JWT Token' })
  @ApiResponse({ status: 401, description: 'KB102 账号或密码错误' })
  @ApiResponse({ status: 429, description: '请求过于频繁' })
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent']
    return this.adminAuthService.login(
      dto.username,
      dto.password,
      req.ip,
      Array.isArray(userAgent) ? userAgent[0] : userAgent,
    )
  }

  @UseGuards(AdminJwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth('user-auth')
  @ApiOperation({ summary: '修改管理员密码' })
  @ApiResponse({ status: 200, description: '密码修改成功' })
  @ApiResponse({ status: 400, description: 'KB913 旧密码错误' })
  changePassword(
    @Body() dto: ChangeAdminPasswordDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    const userAgent = req.headers['user-agent']
    return this.adminService.changeAdminPassword(
      admin.sub,
      dto.oldPassword,
      dto.newPassword,
      {
        ip: req.ip,
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      },
    )
  }
}
