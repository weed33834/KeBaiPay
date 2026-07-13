import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service';

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

// 验证码相关常量
const CODE_TTL_SECONDS = 10 * 60;          // 验证码 10 分钟有效
const RESEND_INTERVAL_SECONDS = 60;         // 同手机号 60s 内不能重发
const MAX_VERIFY_ATTEMPTS = 5;              // 最多验证 5 次
const DAILY_LIMIT_PER_PHONE = 10;           // 单手机号每日最多 10 条
const DAILY_LIMIT_PER_IP = 30;              // 单 IP 每日最多 30 条

@Injectable()
export class SmsService implements OnModuleDestroy {
  private readonly logger = new Logger(SmsService.name);
  private config: SmsConfig | null = null;
  // 进程内 fallback：仅在 Redis 不可用时使用（开发环境）
  private fallbackStore = new Map<string, { code: string; expiresAt: number; attempts: number; createdAt: number }>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private configService: ConfigService,
    private redis: RedisService,
  ) {
    this.loadConfig();
    this.cleanupTimer = setInterval(() => this.cleanExpiredCodes(), 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
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

    // 生产环境禁止使用 mock provider，否则验证码不会真正发送
    if (process.env.NODE_ENV === 'production' && provider === 'mock') {
      throw new Error(
        '生产环境禁止使用 mock 短信 provider，请在 .env 配置 SMS_PROVIDER=aliyun|tencent|huawei 及对应密钥',
      );
    }

    this.logger.log(`短信服务提供商: ${provider}`);
  }

  /**
   * 发送短信验证码
   * @param clientIp 客户端 IP，用于 IP 维度限流
   */
  async sendVerificationCode(
    phone: string,
    scene: 'register' | 'login' | 'reset' | 'bind' = 'login',
    clientIp?: string,
  ): Promise<SendSmsResult> {
    const today = new Date().toISOString().slice(0, 10);

    // 1. 手机号维度日发送量限制
    const phoneDailyKey = `sms:daily:phone:${phone}:${today}`;
    const phoneDailyCount = await this.redis.incr(phoneDailyKey, 24 * 3600);
    if (phoneDailyCount === 1) {
      // 首次 incr 已设 TTL
    }
    if (phoneDailyCount > DAILY_LIMIT_PER_PHONE) {
      this.logger.warn(`手机号 ${phone} 当日发送量超限: ${phoneDailyCount}`);
      return {
        success: false,
        code: 'SMS_DAILY_LIMIT',
        message: '当日发送次数已达上限',
        provider: this.config?.provider || 'unknown',
      };
    }

    // 2. IP 维度日发送量限制（防止单 IP 轮换手机号轰炸）
    if (clientIp) {
      const ipDailyKey = `sms:daily:ip:${clientIp}:${today}`;
      const ipDailyCount = await this.redis.incr(ipDailyKey, 24 * 3600);
      if (ipDailyCount > DAILY_LIMIT_PER_IP) {
        this.logger.warn(`IP ${clientIp} 当日发送量超限: ${ipDailyCount}`);
        return {
          success: false,
          code: 'SMS_IP_DAILY_LIMIT',
          message: '当日发送次数已达上限',
          provider: this.config?.provider || 'unknown',
        };
      }
    }

    // 3. 同手机号 60s 内不能重发（Redis SET NX EX 原子实现）
    const rateLimitKey = `sms:ratelimit:${phone}:${scene}`;
    const acquired = await this.redis.setRateLimit(rateLimitKey, RESEND_INTERVAL_SECONDS);
    if (!acquired) {
      return {
        success: false,
        code: 'SMS_RATE_LIMIT',
        message: `${RESEND_INTERVAL_SECONDS}秒内不能重复发送验证码`,
        provider: this.config?.provider || 'unknown',
      };
    }

    // 4. 生成验证码
    const code = this.generateCode();

    // 5. 存储验证码（Redis 优先，多实例共享）
    await this.storeCode(phone, scene, code);

    // 6. 发送短信
    const result = await this.sendSms(phone, code, scene);

    if (result.success) {
      this.logger.log(`验证码已发送: ${phone} -> ${scene}`);
    } else {
      this.logger.warn(`验证码发送失败: ${phone} -> ${result.message}`);
      // 发送失败时回滚限流计数，避免运营商失败也消耗用户配额
      await this.redis.decr(phoneDailyKey).catch(() => {});
      if (clientIp) {
        await this.redis.decr(`sms:daily:ip:${clientIp}:${today}`).catch(() => {});
      }
    }

    return result;
  }

  /**
   * 验证码校验
   */
  async verifyCode(phone: string, code: string, scene: 'register' | 'login' | 'reset' | 'bind' = 'login'): Promise<VerifyCodeResult> {
    const stored = await this.loadCode(phone, scene);

    if (!stored) {
      return { valid: false, message: '验证码不存在或已过期' };
    }

    if (Date.now() > stored.expiresAt) {
      await this.deleteCode(phone, scene);
      return { valid: false, message: '验证码已过期' };
    }

    if (stored.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.deleteCode(phone, scene);
      return { valid: false, message: '验证码错误次数过多，请重新获取' };
    }

    if (stored.code !== code) {
      stored.attempts++;
      await this.saveCode(phone, scene, stored);
      return { valid: false, message: `验证码错误，还剩${MAX_VERIFY_ATTEMPTS - stored.attempts}次机会` };
    }

    // 验证成功，删除验证码
    await this.deleteCode(phone, scene);
    return { valid: true, message: '验证成功' };
  }

  /**
   * 生成6位数字验证码（密码学安全随机数）
   */
  private generateCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  // ============ 验证码存储：Redis 优先，进程内 fallback ============

  private codeKey(phone: string, scene: string) {
    return `sms:code:${phone}:${scene}`;
  }

  private async storeCode(phone: string, scene: string, code: string) {
    const data = { code, expiresAt: Date.now() + CODE_TTL_SECONDS * 1000, attempts: 0, createdAt: Date.now() };
    if (this.redis.isEnabled()) {
      await this.redis.set(this.codeKey(phone, scene), JSON.stringify(data), CODE_TTL_SECONDS);
    } else {
      this.fallbackStore.set(this.codeKey(phone, scene), data);
    }
  }

  private async loadCode(phone: string, scene: string) {
    const key = this.codeKey(phone, scene);
    if (this.redis.isEnabled()) {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { code: string; expiresAt: number; attempts: number; createdAt: number };
      } catch {
        return null;
      }
    }
    return this.fallbackStore.get(key) || null;
  }

  private async saveCode(phone: string, scene: string, data: { code: string; expiresAt: number; attempts: number; createdAt: number }) {
    const key = this.codeKey(phone, scene);
    if (this.redis.isEnabled()) {
      // 保留剩余 TTL
      const ttl = await this.redis.getTtl(key);
      if (ttl > 0) {
        await this.redis.set(key, JSON.stringify(data), ttl);
      }
    } else {
      this.fallbackStore.set(key, data);
    }
  }

  private async deleteCode(phone: string, scene: string) {
    const key = this.codeKey(phone, scene);
    if (this.redis.isEnabled()) {
      await this.redis.del(key);
    } else {
      this.fallbackStore.delete(key);
    }
  }

  private cleanExpiredCodes() {
    // 仅清理进程内 fallback，Redis 的 key 自带 TTL 自动过期
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of this.fallbackStore.entries()) {
      if (now > value.expiresAt) {
        this.fallbackStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`清理过期验证码: ${cleaned}个`);
    }
  }

  // ============ 短信发送 ============

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
        SignatureMethod: 'HMAC-SHA1',
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

      // 真实调用阿里云 API（用 httpx/axios 等价的原生 http 模块）
      const http = require('https');
      const result = await new Promise<SendSmsResult>((resolve) => {
        const req = http.get(url, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => { data += chunk; });
          res.on('end', () => {
            try {
              const resp = JSON.parse(data);
              if (resp.Code === 'OK') {
                resolve({
                  success: true,
                  messageId: resp.RequestId || crypto.randomUUID(),
                  code: 'OK',
                  message: '发送成功',
                  provider: 'aliyun',
                });
              } else {
                resolve({
                  success: false,
                  code: resp.Code || 'ALIYUN_ERROR',
                  message: resp.Message || '发送失败',
                  provider: 'aliyun',
                });
              }
            } catch {
              resolve({ success: false, code: 'ALIYUN_PARSE_ERROR', message: '响应解析失败', provider: 'aliyun' });
            }
          });
        });
        req.on('error', (err: Error) => {
          resolve({ success: false, code: 'ALIYUN_NETWORK_ERROR', message: err.message, provider: 'aliyun' });
        });
        req.setTimeout(10000, () => {
          req.destroy();
          resolve({ success: false, code: 'ALIYUN_TIMEOUT', message: '请求超时', provider: 'aliyun' });
        });
      });

      this.logger.log(`[阿里云] 发送验证码到 ${phone}: ${result.success ? '成功' : '失败 ' + result.message}`);
      return result;
    } catch (error: any) {
      return { success: false, code: 'ALIYUN_ERROR', message: error.message || '发送失败', provider: 'aliyun' };
    }
  }

  /**
   * 腾讯云短信（需配 SMS_TENCENT_SECRET_ID 等，使用前应安装 tencentcloud-sdk-nodejs）
   */
  private async sendTencentSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    try {
      // 腾讯云 API 调用需 tencentcloud-sdk-nodejs 包；此处仅记录日志，实际接入需安装 SDK
      // ⚠️ 待办建议：接入腾讯云官方 SDK（npm i tencentcloud-sdk-nodejs）后替换为真实调用
      this.logger.warn(`[腾讯云] 短信 SDK 未接入，验证码 ${code} 未真正发送到 ${phone}（场景: ${scene}）`);
      return {
        success: false,
        code: 'TENCENT_NOT_IMPLEMENTED',
        message: '腾讯云短信 SDK 未接入，请联系管理员',
        provider: 'tencent',
      };
    } catch (error: any) {
      return { success: false, code: 'TENCENT_ERROR', message: error.message || '发送失败', provider: 'tencent' };
    }
  }

  /**
   * 华为云短信（需配 SMS_HUAWEI_APP_ID 等，使用前应安装 @huaweicloud/huaweicloud-sdk-core）
   */
  private async sendHuaweiSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    try {
      // ⚠️ 待办建议：接入华为云官方 SDK 后替换为真实调用
      this.logger.warn(`[华为云] 短信 SDK 未接入，验证码 ${code} 未真正发送到 ${phone}（场景: ${scene}）`);
      return {
        success: false,
        code: 'HUAWEI_NOT_IMPLEMENTED',
        message: '华为云短信 SDK 未接入，请联系管理员',
        provider: 'huawei',
      };
    } catch (error: any) {
      return { success: false, code: 'HUAWEI_ERROR', message: error.message || '发送失败', provider: 'huawei' };
    }
  }

  /**
   * 模拟发送（仅开发环境，生产环境在 loadConfig 时已抛错）
   */
  private async sendMockSms(phone: string, code: string, scene: string): Promise<SendSmsResult> {
    this.logger.log(`[MOCK] 验证码 -> ${phone}: ${code} (场景: ${scene})`);
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
