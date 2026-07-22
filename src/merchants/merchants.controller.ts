import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { MerchantsService } from './merchants.service'
import { RegisterMerchantDto } from './dto/register-merchant.dto'
import { UpdateMyMerchantDto } from './dto/update-my-merchant.dto'
import { CreateMerchantAppDto } from './dto/create-merchant-app.dto'
import { UpdateMerchantAppDto } from './dto/update-merchant-app.dto'
import { CreateMerchantQrCodeDto } from './dto/create-merchant-qr-code.dto'

@ApiTags('商户')
@ApiBearerAuth('user-auth')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('register')
  @ApiOperation({ summary: '商户入驻申请', description: '提交商户资料进行入驻审核' })
  @ApiResponse({ status: 201, description: '申请提交成功，等待审核' })
  @ApiResponse({ status: 400, description: 'KB301 已申请过商户' })
  register(@CurrentUser() user: CurrentUserType, @Body() dto: RegisterMerchantDto) {
    return this.merchantsService.register(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: '获取当前商户信息' })
  @ApiResponse({ status: 200, description: '返回商户详情' })
  @ApiResponse({ status: 404, description: 'KB304 商户不存在' })
  getMyMerchant(@CurrentUser() user: CurrentUserType) {
    return this.merchantsService.getMyMerchant(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @ApiOperation({ summary: '更新商户资料', description: '仅 PENDING/REJECTED 状态可修改' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: 'KB303 当前状态不可修改' })
  updateMyMerchant(@CurrentUser() user: CurrentUserType, @Body() dto: UpdateMyMerchantDto) {
    return this.merchantsService.updateMyMerchant(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('apps')
  @ApiOperation({ summary: '创建商户应用', description: '为商户创建一个 API 应用，获取 appId 和 appSecret' })
  @ApiResponse({ status: 201, description: '创建成功，返回 appId 和 appSecret（请妥善保管）' })
  createApp(@CurrentUser() user: CurrentUserType, @Body() dto: CreateMerchantAppDto) {
    return this.merchantsService.createApp(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('apps')
  @ApiOperation({ summary: '列出商户所有应用' })
  @ApiResponse({ status: 200, description: '返回应用列表' })
  listApps(@CurrentUser() user: CurrentUserType) {
    return this.merchantsService.listApps(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('apps/:appId')
  @ApiOperation({ summary: '更新商户应用设置', description: '可修改应用名称、回调地址' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: 'KB309 无变更 / KB225 应用名称不能为空' })
  updateApp(
    @CurrentUser() user: CurrentUserType,
    @Param('appId') appId: string,
    @Body() dto: UpdateMerchantAppDto,
  ) {
    return this.merchantsService.updateApp(user.id, appId, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('apps/:appId/regenerate-secret')
  @ApiOperation({ summary: '重新生成应用密钥', description: '原密钥立即失效，请及时更新' })
  @ApiResponse({ status: 200, description: '新密钥已生成' })
  regenerateSecret(@CurrentUser() user: CurrentUserType, @Param('appId') appId: string) {
    return this.merchantsService.regenerateSecret(user.id, appId)
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  @ApiOperation({ summary: '商户数据看板', description: '返回今日交易额、订单数等统计' })
  @ApiResponse({ status: 200, description: '返回统计数据' })
  getDashboard(@CurrentUser() user: CurrentUserType) {
    return this.merchantsService.getDashboard(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('qrcodes')
  @ApiOperation({ summary: '创建商户收款码' })
  @ApiResponse({ status: 201, description: '收款码创建成功' })
  createQrCode(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateMerchantQrCodeDto,
  ) {
    return this.merchantsService.createQrCode(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('qrcodes')
  @ApiOperation({ summary: '列出商户收款码' })
  @ApiResponse({ status: 200, description: '返回收款码列表' })
  listMyQrCodes(@CurrentUser() user: CurrentUserType) {
    return this.merchantsService.listMyQrCodes(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Delete('qrcodes/:id')
  @ApiOperation({ summary: '删除商户收款码' })
  @ApiResponse({ status: 200, description: '删除成功' })
  deleteQrCode(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.merchantsService.deleteQrCode(user.id, id)
  }
}
