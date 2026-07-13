import { Controller, Post, Body, Get, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Request } from 'express';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * 发送验证码
   * POST /sms/send
   * 无需登录态（注册/登录/重置密码场景需在登录前调用），
   * 防轰炸靠手机号 + IP 双维度限流（在 SmsService 内基于 Redis 实现）
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() body: { phone: string; scene?: string }, @Req() req: Request) {
    const { phone, scene = 'login' } = body;

    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return { success: false, message: '手机号格式不正确' };
    }

    // 提取客户端真实 IP（信任反向代理设置的 X-Forwarded-For）
    const clientIp = this.getClientIp(req);

    return this.smsService.sendVerificationCode(phone, scene as any, clientIp);
  }

  /**
   * 验证码校验
   * POST /sms/verify
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyCode(@Body() body: { phone: string; code: string; scene?: string }) {
    const { phone, code, scene = 'login' } = body;

    if (!phone || !code) {
      return { valid: false, message: '手机号和验证码不能为空' };
    }

    return await this.smsService.verifyCode(phone, code, scene as any);
  }

  /**
   * 获取短信配置状态
   * GET /sms/config
   */
  @Get('config')
  getConfig() {
    return this.smsService.getConfigStatus();
  }

  private getClientIp(req: Request): string | undefined {
    // 信任 X-Forwarded-For（main.ts 已设 trust proxy）
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim()
    }
    return req.ip
  }
}
