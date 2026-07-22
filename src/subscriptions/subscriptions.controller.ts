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
import { SubscriptionsService } from './subscriptions.service'
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto'
import { SubscribeDto, CancelSubscriptionDto } from './dto/subscribe.dto'
import {
  ListSubscriptionDto,
  ListSubscriptionChargeDto,
} from './dto/list-subscription.dto'

@ApiTags('订阅/周期扣款')
@ApiBearerAuth('user-auth')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // ============== 订阅计划管理 ==============

  @UseGuards(JwtAuthGuard)
  @Post('plans')
  @ApiOperation({ summary: '创建订阅计划', description: '商家/收款方创建可订阅计划' })
  @ApiResponse({ status: 201, description: '计划创建成功' })
  createPlan(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateSubscriptionPlanDto,
  ) {
    return this.subscriptionsService.createPlan(user.id, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Get('plans/:planNo')
  @ApiOperation({ summary: '查询计划详情' })
  findPlanByNo(@Param('planNo') planNo: string) {
    return this.subscriptionsService.findPlanByNo(planNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('plans')
  @ApiOperation({ summary: '列出我的订阅计划' })
  listPlans(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListSubscriptionDto,
  ) {
    return this.subscriptionsService.listPlans(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Put('plans/:planNo/status')
  @ApiOperation({ summary: '启用/禁用计划', description: 'body.status = ACTIVE | DISABLED' })
  setPlanStatus(
    @CurrentUser() user: CurrentUserType,
    @Param('planNo') planNo: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' },
  ) {
    return this.subscriptionsService.setPlanStatus(user.id, planNo, body.status)
  }

  // ============== 用户订阅管理 ==============

  @UseGuards(JwtAuthGuard)
  @Post(':planNo/subscribe')
  @ApiOperation({
    summary: '订阅计划',
    description: '立即扣首期款（无试用期）或设置 nextChargeAt=trialEnd（有试用期）',
  })
  @ApiResponse({ status: 201, description: '订阅成功' })
  subscribe(
    @CurrentUser() user: CurrentUserType,
    @Param('planNo') planNo: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.subscriptionsService.subscribe(user.id, planNo, dto)
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscriptions/:subscriptionNo/cancel')
  @ApiOperation({ summary: '取消订阅', description: '不再扣款，已扣款不退回' })
  cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('subscriptionNo') subscriptionNo: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionsService.cancel(user.id, subscriptionNo, dto.reason)
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscriptions/:subscriptionNo/suspend')
  @ApiOperation({ summary: '暂停订阅' })
  suspend(
    @CurrentUser() user: CurrentUserType,
    @Param('subscriptionNo') subscriptionNo: string,
  ) {
    return this.subscriptionsService.suspend(user.id, subscriptionNo)
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscriptions/:subscriptionNo/resume')
  @ApiOperation({ summary: '恢复订阅' })
  resume(
    @CurrentUser() user: CurrentUserType,
    @Param('subscriptionNo') subscriptionNo: string,
  ) {
    return this.subscriptionsService.resume(user.id, subscriptionNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscriptions/:subscriptionNo')
  @ApiOperation({ summary: '查询订阅详情' })
  findBySubscriptionNo(
    @CurrentUser() user: CurrentUserType,
    @Param('subscriptionNo') subscriptionNo: string,
  ) {
    return this.subscriptionsService.findBySubscriptionNo(user.id, subscriptionNo)
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscriptions')
  @ApiOperation({ summary: '列出我的订阅' })
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListSubscriptionDto,
  ) {
    return this.subscriptionsService.list(user.id, query)
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscriptions/:subscriptionNo/charges')
  @ApiOperation({ summary: '列出订阅扣款记录' })
  listCharges(
    @CurrentUser() user: CurrentUserType,
    @Param('subscriptionNo') subscriptionNo: string,
    @Query() query: ListSubscriptionChargeDto,
  ) {
    return this.subscriptionsService.listCharges(user.id, subscriptionNo, query)
  }
}
