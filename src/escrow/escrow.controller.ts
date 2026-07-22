import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { EscrowService } from './escrow.service'
import { CreateEscrowDto } from './dto/create-escrow.dto'
import { PayEscrowDto } from './dto/pay-escrow.dto'
import { EscrowReasonDto, EscrowResolveDto } from './dto/escrow-reason.dto'
import { ListEscrowDto } from './dto/list-escrow.dto'

@ApiTags('担保交易')
@ApiBearerAuth('user-auth')
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @UseGuards(JwtAuthGuard)
  @Post('orders')
  @ApiOperation({ summary: '创建担保订单', description: '买家发起担保交易，仅创建订单，不扣款' })
  @ApiResponse({ status: 201, description: '订单创建成功，请在 30 分钟内付款' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateEscrowDto) {
    return this.escrowService.create(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/pay')
  @ApiOperation({ summary: '买家付款', description: '资金冻结到买家账户的 frozenBalance' })
  @ApiResponse({ status: 201, description: '付款成功' })
  pay(
    @CurrentUser() user: CurrentUserType,
    @Param('orderNo') orderNo: string,
    @Body() dto: PayEscrowDto,
  ) {
    return this.escrowService.pay(user.id, orderNo, dto.payPassword)
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/ship')
  @ApiOperation({ summary: '卖家标记发货', description: '仅 PAID 状态可调用' })
  ship(@CurrentUser() user: CurrentUserType, @Param('orderNo') orderNo: string) {
    return this.escrowService.ship(user.id, orderNo)
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/confirm')
  @ApiOperation({ summary: '买家确认收货', description: '放款给卖家' })
  confirm(@CurrentUser() user: CurrentUserType, @Param('orderNo') orderNo: string) {
    return this.escrowService.confirm(user.id, orderNo)
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/refund-request')
  @ApiOperation({ summary: '买家申请退款', description: '仅 SHIPPED 状态可申请' })
  refundRequest(
    @CurrentUser() user: CurrentUserType,
    @Param('orderNo') orderNo: string,
    @Body() dto: EscrowReasonDto,
  ) {
    return this.escrowService.requestRefund(user.id, orderNo, dto.reason)
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/refund-resolve')
  @ApiOperation({ summary: '卖家处理退款申请', description: 'decision=APPROVE_REFUND 同意 / REJECT_REFUND 拒绝' })
  refundResolve(
    @CurrentUser() user: CurrentUserType,
    @Param('orderNo') orderNo: string,
    @Body() dto: EscrowResolveDto,
  ) {
    return this.escrowService.resolveRefund(user.id, orderNo, dto.decision as 'APPROVE_REFUND' | 'REJECT_REFUND', dto.reason)
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderNo/cancel')
  @ApiOperation({ summary: '买家取消订单', description: '仅 CREATED 状态可取消' })
  cancel(@CurrentUser() user: CurrentUserType, @Param('orderNo') orderNo: string) {
    return this.escrowService.cancel(user.id, orderNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders/:orderNo')
  @ApiOperation({ summary: '查询担保订单详情' })
  findByOrderNo(@CurrentUser() user: CurrentUserType, @Param('orderNo') orderNo: string) {
    return this.escrowService.findByOrderNo(user.id, orderNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders')
  @ApiOperation({ summary: '列出担保订单', description: 'role=buyer/seller/all，可按 status 过滤' })
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListEscrowDto) {
    return this.escrowService.list(user.id, query)
  }
}
