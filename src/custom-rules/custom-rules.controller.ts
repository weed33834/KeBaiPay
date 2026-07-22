import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { AdminCurrentUser } from '../admin/admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from '../admin/admin-current-user.interface'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { CustomRulesService } from './custom-rules.service'
import {
  CreateCustomRuleDto,
  UpdateCustomRuleDto,
  TestRuleDto,
  ListCustomRuleDto,
} from './dto/custom-rule.dto'

@ApiTags('自定义风控规则')
@ApiBearerAuth('user-auth')
@Controller()
export class CustomRulesController {
  constructor(private readonly customRulesService: CustomRulesService) {}

  // ============== 管理端 ==============

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('risk:config')
  @Post('admin/risk-rules/custom')
  @ApiOperation({ summary: '创建自定义规则' })
  async create(
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Body() dto: CreateCustomRuleDto,
  ) {
    return this.customRulesService.create(admin.sub, dto)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/risk-rules/custom')
  @ApiOperation({ summary: '查询自定义规则列表' })
  async list(@Query() query: ListCustomRuleDto) {
    return this.customRulesService.list(query)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('admin:view')
  @Get('admin/risk-rules/custom/:ruleNo')
  @ApiOperation({ summary: '查询自定义规则详情' })
  async findByRuleNo(@Param('ruleNo') ruleNo: string) {
    return this.customRulesService.findByRuleNo(ruleNo)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('risk:config')
  @Put('admin/risk-rules/custom/:ruleNo')
  @ApiOperation({ summary: '更新自定义规则' })
  async update(
    @Param('ruleNo') ruleNo: string,
    @Body() dto: UpdateCustomRuleDto,
  ) {
    return this.customRulesService.update(ruleNo, dto)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('risk:config')
  @Delete('admin/risk-rules/custom/:ruleNo')
  @ApiOperation({ summary: '删除自定义规则' })
  async delete(@Param('ruleNo') ruleNo: string) {
    return this.customRulesService.delete(ruleNo)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('risk:config')
  @Post('admin/risk-rules/custom/:ruleNo/toggle')
  @ApiOperation({ summary: '启用/禁用自定义规则' })
  async toggle(
    @Param('ruleNo') ruleNo: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.customRulesService.toggle(ruleNo, body.enabled)
  }

  @UseGuards(AdminJwtAuthGuard, PermissionsGuard)
  @RequirePermissions('risk:config')
  @Post('admin/risk-rules/custom/test')
  @ApiOperation({ summary: '测试自定义规则（不持久化）' })
  async test(@Body() dto: TestRuleDto) {
    return this.customRulesService.test(dto)
  }

  // ============== 用户端 ==============

  @UseGuards(JwtAuthGuard)
  @Get('risk-rules/custom')
  @ApiOperation({ summary: '用户查询当前生效的自定义规则' })
  async listActive(@CurrentUser() _user: CurrentUserType) {
    const items = await this.customRulesService.list({
      enabled: true,
      page: 1,
      limit: 100,
    })
    // 用户视角：仅返回名称、描述、动作、优先级，不返回 conditions 详情
    return {
      items: items.items.map((r: any) => ({
        ruleNo: r.ruleNo,
        name: r.name,
        description: r.description,
        action: r.action,
        priority: r.priority,
        hitCount: r.hitCount,
      })),
    }
  }
}
