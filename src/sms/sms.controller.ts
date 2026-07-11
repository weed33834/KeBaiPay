import { Controller, Post, Body, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * 发送验证码
   * POST /sms/send
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() body: { phone: string; scene?: string }) {
    const { phone, scene = 'login' } = body;
    
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return { success: false, message: '手机号格式不正确' };
    }

    return this.smsService.sendVerificationCode(phone, scene as any);
  }

  /**
   * 验证码校验
   * POST /sms/verify
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verifyCode(@Body() body: { phone: string; code: string; scene?: string }) {
    const { phone, code, scene = 'login' } = body;
    
    if (!phone || !code) {
      return { valid: false, message: '手机号和验证码不能为空' };
    }

    return this.smsService.verifyCode(phone, code, scene as any);
  }

  /**
   * 获取短信配置状态
   * GET /sms/config
   */
  @Get('config')
  getConfig() {
    return this.smsService.getConfigStatus();
  }
}
