import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { CouponsService } from './coupons.service'
import { CreateCouponDto, UpdateCouponStatusDto, UseUserCouponDto } from './dto/create-coupon.dto'
import { ListCouponDto, ListUserCouponDto } from './dto/list-coupon.dto'

@ApiTags('优惠券 / 折扣码')
@ApiBearerAuth('user-auth')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // ============== 商家管理 ==============

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: '创建优惠券' })
  @ApiResponse({ status: 201, description: '优惠券创建成功' })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateCouponDto) {
    return this.couponsService.createCoupon(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':couponNo')
  @ApiOperation({ summary: '查询优惠券详情' })
  findByCouponNo(@Param('couponNo') couponNo: string) {
    return this.couponsService.findByCouponNo(couponNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '列出我创建的优惠券' })
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListCouponDto) {
    return this.couponsService.listCoupons(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Put(':couponNo/status')
  @ApiOperation({ summary: '启用/禁用优惠券' })
  setCouponStatus(
    @CurrentUser() user: CurrentUserType,
    @Param('couponNo') couponNo: string,
    @Body() dto: UpdateCouponStatusDto,
  ) {
    return this.couponsService.setCouponStatus(user.id, couponNo, dto.status as 'ACTIVE' | 'DISABLED')
  }

  // ============== 用户领取与使用 ==============

  @UseGuards(JwtAuthGuard)
  @Post(':couponNo/claim')
  @ApiOperation({ summary: '领取优惠券' })
  @ApiResponse({ status: 201, description: '领取成功' })
  claim(
    @CurrentUser() user: CurrentUserType,
    @Param('couponNo') couponNo: string,
  ) {
    return this.couponsService.claim(user.id, couponNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine/list')
  @ApiOperation({ summary: '列出我领取的优惠券' })
  listMine(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListUserCouponDto,
  ) {
    return this.couponsService.listMyCoupons(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Post('mine/:userCouponNo/use')
  @ApiOperation({ summary: '使用用户优惠券', description: '返回折扣金额和最终金额' })
  use(
    @CurrentUser() user: CurrentUserType,
    @Param('userCouponNo') userCouponNo: string,
    @Body() dto: UseUserCouponDto,
  ) {
    return this.couponsService.useUserCoupon(user.id, userCouponNo, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine/:userCouponNo')
  @ApiOperation({ summary: '查询用户优惠券详情' })
  findMine(
    @CurrentUser() user: CurrentUserType,
    @Param('userCouponNo') userCouponNo: string,
  ) {
    return this.couponsService.findUserCoupon(user.id, userCouponNo)
  }
}
