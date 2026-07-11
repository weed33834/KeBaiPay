import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { QrCodesService } from './qr-codes.service'
import { CreateFixedCodeDto } from './dto/create-fixed-code.dto'
import { PayByQrCodeDto } from './dto/pay-by-qr-code.dto'

@ApiTags('收款码')
@ApiBearerAuth('user-auth')
@Controller('qr-codes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @UseGuards(JwtAuthGuard)
  @Get('personal')
  @ApiOperation({ summary: '获取个人收款码', description: '获取或创建个人动态收款码' })
  @ApiResponse({ status: 200, description: '返回收款码信息' })
  getPersonalCode(@CurrentUser() user: CurrentUserType) {
    return this.qrCodesService.getPersonalCode(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('fixed')
  @ApiOperation({ summary: '创建固定金额收款码', description: '创建指定金额的静态收款码' })
  @ApiResponse({ status: 201, description: '收款码创建成功' })
  createFixedCode(@CurrentUser() user: CurrentUserType, @Body() dto: CreateFixedCodeDto) {
    return this.qrCodesService.createFixedCode(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('pay')
  @ApiOperation({ summary: '扫码付款', description: '扫描收款码进行付款' })
  @ApiResponse({ status: 201, description: '付款成功' })
  @ApiResponse({ status: 400, description: 'KB610 收款码无效 / KB611 不能扫自己的码' })
  pay(@CurrentUser() user: CurrentUserType, @Body() dto: PayByQrCodeDto) {
    return this.qrCodesService.pay(user.id, dto)
  }
}
