import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface SmsConfig {
  provider: 'aliyun' | 'tencent' | 'huawei' | 'mock';
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  // 腾讯云专用
  secretId?: string;
  secretKey?: string;
  sdkAppId?: string;
  // 华为云专用
  appId?: string;
  appSecret?: string;
  channel?: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  code: string;
  message: string;
  provider: string;
}

export interface VerifyCodeResult {
  valid: boolean;
  message: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private config: SmsConfig | null = null;
  private codeStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

  constructor(private configService: ConfigService) {
    this.loadConfig();
    // 每5分钟清理过期验证码
    setInterval(() => this.cleanExpiredCodes(), 5 * 60 * 1000);
  }

  private loadConfig() {
    const provider = this.configService.get<string>('SMS_PROVIDER', 'mock');
    
    this.config = {
      provider: provider as any,
      accessKeyId: this.configService.get('SMS_ACCESS_KEY_ID', ''),
      accessKeySecret: this.configService.get('SMS_ACCESS_KEY_SECRET', ''),
      signName: this.configService.get('SMS_SIGN_NAME', '科佰支付'),
      templateCode: this.configService.get('SMS_TEMPLATE_CODE', ''),
      secretId: this.configService.get('SMS_TENCENT_SECRET_ID', ''),
      secretKey: this.configService.get('SMS_TENCENT_SECRET_KEY', ''),
      sdkAppId: this.configService.get('SMS_TENCENT_SDK_APP_ID', ''),
      appId: this.configService.get('SMS_HUAWEI_APP_ID', ''),
      appSecret: this.configService.get('SMS_HUAWEI_APP_SECRET', ''),
      channel: this.configService.get('SMS_HUAWEI_CHANNEL', 'sms'),
    };

    this.logger.log(`短信服务提供商: ${provider}`);
  }

  /**
   * 发送短信验证码
   */
  async sendVerificationCode(phone: string, scene: 'register' | 'login' | 'reset' | 'bind' = 'login'): Promise<SendSmsResult> {
    // 生成6位验证码
    const code = this.generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10分钟有效

    // 存储验证码
    const key = `${phone}:${scene}`;
    const existing = this.codeStore.get(key);
    
    // 防刷：60秒内不能重复发送
    if (existing && Date.now() - (existing.expiresAt - 10 * 60 * 1000) < 60 * 1000) {
      return {
        success: false,
        code: 'SMS频率限制',
        message: '60秒内不能重复发送验证码',
        provider: this.config?.provider || 'unknown',
      };
    }

    this.codeStore.set(key, { code, expiresAt, attempts: 0 });

    // 发送短信
    const result = await this.sendSms(phone, code, scene);
    
    if (result.success) {
      this.logger.log(`验证码已发送: ${phone} -> ${scene}`);
    } else {
      this.logger.warn(`验证码发送失败: ${phone} -> ${result.message}`);
    }

    return result;
  }

  /**
   * 验证码校验
   */
  verifyCode(phone: string, code: string, scene: 'register' | 'login' | 'reset' | 'bind' = 'login'): VerifyCodeResult {
    const key = `${phone}:${scene}`;
    const stored = this.codeStore.get(key);

    if (!stored) {
      return { valid: false, message: '验证码不存在或已过期' };
    }

    if (Date.now() > stored.expiresAt) {
      this.codeStore.delete(key);
      return { valid: false, message: '验证码已过期' };
    }

    if (stored.attempts >= 5) {
      this.codeStore.delete(key);
      return { valid: false, message: '验证码错误次数过多，请重新获取' };
    }

    if (stored.code !== code) {
      stored.attempts++;
      return { valid: false, message: `验证码错误，还剩${5 - stored.attempts}次机会` };
    }

    // 验证成功，删除验证码
    this.codeStore.delete(key);
    return { valid: true, message: '验证成功' };
  }

  /**
   * 生成6位数字验证码
   */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 清理过期验证码
   */
  private cleanExpiredCodes() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of this.codeStore.entries()) {
      if (now > value.expiresAt) {
        this.codeStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`清理过期验证码: ${cleaned}个`);
    }
  }

  /**
   * 发送短信（根据提供商选择）
   */
  private async sendSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    if (!this.config) {
      return { success: false, code: 'CONFIG_ERROR', message: '短信配置未加载', provider: 'unknown' };
    }

    switch (this.config.provider) {
      case 'aliyun':
        return this.sendAliyunSms(phone, code, scene);
      case 'tencent':
        return this.sendTencentSms(phone, code, scene);
      case 'huawei':
        return this.sendHuaweiSms(phone, code, scene);
      case 'mock':
      default:
        return this.sendMockSms(phone, code, scene);
    }
  }

  /**
   * 阿里云短信
   */
  private async sendAliyunSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    try {
      const params: Record<string, string> = {
        PhoneNumbers: phone,
        SignName: this.config?.signName || '',
        TemplateCode: this.config?.templateCode || 'SMS_123456',
        TemplateParam: JSON.stringify({ code, scene }),
        AccessKeyId: this.config?.accessKeyId || '',
        SignatureMethod: 'hmac-sha1',
        SignatureNonce: crypto.randomUUID(),
        SignatureVersion: '1.0',
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Format: 'JSON',
        Action: 'SendSms',
        Version: '2017-05-25',
        RegionId: 'cn-hangzhou',
      };

      // 构造签名
      const sortedParams = Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
      const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(sortedParams)}`;
      const signature = crypto.createHmac('sha1', (this.config?.accessKeySecret || '') + '&').update(stringToSign).digest('base64');

      const url = `https://dysmsapi.aliyuncs.com/?Signature=${encodeURIComponent(signature)}&${sortedParams}`;
      
      // 模拟发送（实际项目中使用axios调用）
      this.logger.log(`[阿里云] 发送验证码到 ${phone}: ${code}`);
      
      return {
        success: true,
        messageId: crypto.randomUUID(),
        code: 'OK',
        message: '发送成功',
        provider: 'aliyun',
      };
    } catch (error: any) {
      return { success: false, code: 'ALIYUN_ERROR', message: error.message || '发送失败', provider: 'aliyun' };
    }
  }

  /**
   * 腾讯云短信
   */
  private async sendTencentSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    try {
      const params = {
        SmsSdkAppId: this.config?.sdkAppId || '',
        SignName: this.config?.signName || '',
        TemplateId: this.config?.templateCode || '',
        PhoneNumberSet: [`+86${phone}`],
        TemplateParamSet: [code, '10'],
      };

      // 腾讯云API调用（实际项目中使用腾讯云SDK）
      this.logger.log(`[腾讯云] 发送验证码到 ${phone}: ${code}`);
      
      return {
        success: true,
        messageId: crypto.randomUUID(),
        code: 'OK',
        message: '发送成功',
        provider: 'tencent',
      };
    } catch (error: any) {
      return { success: false, code: 'TENCENT_ERROR', message: error.message || '发送失败', provider: 'tencent' };
    }
  }

  /**
   * 华为云短信
   */
  private async sendHuaweiSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    try {
      const params = {
        channel: this.config?.channel || 'sms',
        sender: this.config?.signName || '',
        to: phone,
        templateId: this.config?.templateCode || '',
        templateParams: [code, '10'],
      };

      // 华为云API调用（实际项目中使用华为云SDK）
      this.logger.log(`[华为云] 发送验证码到 ${phone}: ${code}`);
      
      return {
        success: true,
        messageId: crypto.randomUUID(),
        code: 'OK',
        message: '发送成功',
        provider: 'huawei',
      };
    } catch (error: any) {
      return { success: false, code: 'HUAWEI_ERROR', message: error.message || '发送失败', provider: 'huawei' };
    }
  }

  /**
   * 模拟发送（开发环境）
   */
  private async sendMockSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    this.logger.log(`[MOCK] 验证码 -> ${phone}: ${code} (场景: ${scene})`);
    console.log(`\n====================================`);
    console.log(`📱 短信验证码`);
    console.log(`手机号: ${phone}`);
    console.log(`验证码: ${code}`);
    console.log(`场景: ${scene}`);
    console.log(`====================================\n`);
    
    return {
      success: true,
      messageId: crypto.randomUUID(),
      code: 'OK',
      message: '发送成功（开发模式）',
      provider: 'mock',
    };
  }

  /**
   * 获取配置状态
   */
  getConfigStatus() {
    return {
      provider: this.config?.provider || 'unknown',
      configured: this.config?.provider !== 'mock',
      hasAccessKey: !!this.config?.accessKeyId,
      hasSignName: !!this.config?.signName,
    };
  }
}
