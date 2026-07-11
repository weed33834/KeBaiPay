import { Body, Controller, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { Request } from 'express'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { AUTH_THROTTLE_LIMIT, AUTH_THROTTLE_TTL_MS } from '../common/constants'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Throttle({ default: { ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT } })
  @Post('register')
  @ApiOperation({ summary: '用户注册', description: '通过手机号或邮箱注册新用户' })
  @ApiResponse({ status: 201, description: '注册成功，返回 JWT Token' })
  @ApiResponse({ status: 400, description: 'KB400 参数错误' })
  @ApiResponse({ status: 429, description: '请求过于频繁' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Throttle({ default: { ttl: AUTH_THROTTLE_TTL_MS, limit: AUTH_THROTTLE_LIMIT } })
  @Post('login')
  @ApiOperation({ summary: '用户登录', description: '通过手机号/邮箱 + 密码登录' })
  @ApiResponse({ status: 200, description: '登录成功，返回 JWT Token' })
  @ApiResponse({ status: 401, description: 'KB102 账号或密码错误' })
  @ApiResponse({ status: 403, description: 'KB104 账号已冻结' })
  @ApiResponse({ status: 429, description: '请求过于频繁' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    )
  }
}
