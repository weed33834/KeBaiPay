import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Request } from 'express'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'
import { RequirePermissions } from './permissions.decorator'
import { AdminCurrentUser } from './admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from './admin-current-user.interface'
import { AdminService, type AuditMeta } from './admin.service'
import { SetSystemConfigDto } from './dto/set-system-config.dto'

@ApiTags('管理后台')
@ApiBearerAuth('user-auth')
@Controller('admin/system-config')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class SystemConfigController {
  constructor(private readonly adminService: AdminService) {}

  private extractAuditMeta(req: Request): AuditMeta {
    const userAgent = req.headers['user-agent']
    return {
      ip: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    }
  }

  @Get()
  @ApiOperation({ summary: '获取所有系统配置' })
  @ApiResponse({ status: 200, description: '返回配置列表' })
  getAll() {
    return this.adminService.getSystemConfigs()
  }

  @Get(':key')
  @ApiOperation({ summary: '获取指定配置项' })
  @ApiResponse({ status: 200, description: '返回配置值' })
  getByKey(@Param('key') key: string) {
    return this.adminService.getSystemConfigByKey(key)
  }

  @Post()
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '创建系统配置' })
  @ApiResponse({ status: 201, description: '配置创建成功' })
  create(
    @Body() dto: SetSystemConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.createSystemConfig(
      dto.key,
      dto.value,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }

  @Put(':key')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '更新系统配置' })
  @ApiResponse({ status: 200, description: '配置更新成功' })
  update(
    @Param('key') key: string,
    @Body() dto: SetSystemConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    return this.adminService.updateSystemConfig(
      key,
      dto.value,
      admin.sub,
      this.extractAuditMeta(req),
    )
  }
}
