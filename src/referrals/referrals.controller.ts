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
import { ReferralsService } from './referrals.service'
import { BindReferralDto, ListReferralDto, CancelReferralDto, TriggerRewardDto } from './dto/referral.dto'

@ApiTags('邀请返现 / 推荐奖励')
@ApiBearerAuth('user-auth')
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  // ============== 邀请人视角 ==============

  @UseGuards(JwtAuthGuard)
  @Post('code')
  @ApiOperation({ summary: '生成或获取我的邀请码' })
  @ApiResponse({ status: 201, description: '邀请码创建/返回成功' })
  getOrCreateMyCode(@CurrentUser() user: CurrentUserType) {
    return this.referralsService.getOrCreateMyCode(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('code')
  @ApiOperation({ summary: '查询我的邀请码' })
  findMyCode(@CurrentUser() user: CurrentUserType) {
    return this.referralsService.findMyCode(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  @ApiOperation({ summary: '我的邀请统计' })
  getStats(@CurrentUser() user: CurrentUserType) {
    return this.referralsService.getStats(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: '列出我邀请的人' })
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListReferralDto,
  ) {
    return this.referralsService.listMyReferrals(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get(':referralNo')
  @ApiOperation({ summary: '查询邀请关系详情' })
  findByReferralNo(@Param('referralNo') referralNo: string) {
    return this.referralsService.findByReferralNo(referralNo)
  }

  @UseGuards(JwtAuthGuard)
  @Post(':referralNo/cancel')
  @ApiOperation({ summary: '取消邀请关系（仅 PENDING 状态）' })
  cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('referralNo') referralNo: string,
    @Body() dto: CancelReferralDto,
  ) {
    return this.referralsService.cancel(user.id, referralNo, dto)
  }

  // ============== 被邀请人视角 ==============

  @UseGuards(JwtAuthGuard)
  @Post('bind')
  @ApiOperation({ summary: '绑定邀请关系（被邀请人调用）' })
  @ApiResponse({ status: 201, description: '绑定成功' })
  bind(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: BindReferralDto,
  ) {
    return this.referralsService.bindInvitee(user.id, dto)
  }

  // ============== 内部触发奖励发放 ==============

  @UseGuards(JwtAuthGuard)
  @Post('mine/trigger')
  @ApiOperation({ summary: '触发我（被邀请人）的邀请奖励发放' })
  triggerReward(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: TriggerRewardDto,
  ) {
    return this.referralsService.triggerReward(user.id, dto)
  }
}
