import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { RedPacketsService } from './red-packets.service'
import { CreateRedPacketDto, ReceiveRedPacketDto } from './dto/create-red-packet.dto'

@ApiTags('红包')
@ApiBearerAuth('user-auth')
@Controller('red-packets')
export class RedPacketsController {
  constructor(private readonly redPacketsService: RedPacketsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '发红包', description: '创建红包并从余额扣款。支持拼手气/普通/专属/口令四种类型' })
  @ApiResponse({ status: 201, description: '红包创建成功' })
  @ApiResponse({ status: 400, description: 'KB613 金额无效 / KB005 余额不足 / KB622 类型无效 / KB623 数量无效' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateRedPacketDto) {
    return this.redPacketsService.create(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':packetNo/receive')
  @ApiOperation({ summary: '领取红包', description: '领取指定红包。口令红包需提供 password' })
  @ApiResponse({ status: 200, description: '领取成功' })
  @ApiResponse({ status: 400, description: 'KB615 已领取或过期 / KB616 不能领自己的红包 / KB626 需口令 / KB627 口令错误 / KB625 非专属收款人' })
  receive(
    @CurrentUser() user: CurrentUserType,
    @Param('packetNo') packetNo: string,
    @Body() body: ReceiveRedPacketDto = {},
    @Query('idempotencyKey') idempotencyKey?: string,
  ) {
    return this.redPacketsService.receive(user.id, packetNo, {
      idempotencyKey,
      password: body.password,
    })
  }

  @UseGuards(JwtAuthGuard)
  @Get('sent')
  @ApiOperation({ summary: '查询已发红包' })
  @ApiResponse({ status: 200, description: '返回已发红包列表' })
  findSent(@CurrentUser() user: CurrentUserType) {
    return this.redPacketsService.findSent(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('received')
  @ApiOperation({ summary: '查询已收红包' })
  @ApiResponse({ status: 200, description: '返回已收红包列表' })
  findReceived(@CurrentUser() user: CurrentUserType) {
    return this.redPacketsService.findReceived(user.id)
  }
}
