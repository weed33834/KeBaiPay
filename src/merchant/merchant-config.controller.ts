import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

interface MerchantConfig {
  // 基础配置
  appName: string;
  appDomain: string;
  appDescription: string;
  
  // 回调配置
  notifyUrl: string;
  returnUrl: string;
  
  // 安全配置
  ipWhitelist: string[];
  enableSignature: boolean;
  
  // 通知配置
  emailNotify: boolean;
  smsNotify: boolean;
  
  // 其他配置
  customParams: Record<string, any>;
}

@ApiTags('商户配置')
@ApiBearerAuth()
@Controller('merchant/config')
@UseGuards(JwtAuthGuard)
export class MerchantConfigController {
  private configStore = new Map<string, MerchantConfig>();

  /**
   * 获取商户配置
   * GET /merchant/config
   */
  @Get()
  @ApiOperation({ summary: '获取商户配置' })
  getConfig(@Request() req: any) {
    const merchantId = req.user.id;
    const config = this.configStore.get(merchantId) || this.getDefaultConfig();
    return { success: true, data: config };
  }

  /**
   * 更新商户配置
   * PUT /merchant/config
   */
  @Put()
  @ApiOperation({ summary: '更新商户配置' })
  updateConfig(@Request() req: any, @Body() config: Partial<MerchantConfig>) {
    const merchantId = req.user.id;
    const existing = this.configStore.get(merchantId) || this.getDefaultConfig();
    
    const updated = {
      ...existing,
      ...config,
      // 防止修改关键字段
      merchantId: merchantId,
    };
    
    this.configStore.set(merchantId, updated);
    
    return { success: true, data: updated, message: '配置已更新' };
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): MerchantConfig {
    return {
      appName: '',
      appDomain: '',
      appDescription: '',
      notifyUrl: '',
      returnUrl: '',
      ipWhitelist: [],
      enableSignature: true,
      emailNotify: true,
      smsNotify: false,
      customParams: {},
    };
  }
}
