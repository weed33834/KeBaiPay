import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'
import { RequirePermissions } from './permissions.decorator'
import { AdminCurrentUser } from './admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from './admin-current-user.interface'
import { AdminService } from './admin.service'
import {
  CreateAdminUserDto,
  UpdateAdminUserDto,
  ResetAdminPasswordDto,
  ListAdminUsersQueryDto,
} from './dto/admin-user.dto'

@ApiTags('管理后台')
@ApiBearerAuth('user-auth')
@Controller('admin/admin-users')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminUserController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @RequirePermissions('user:status')
  @ApiOperation({ summary: '管理员列表' })
  @ApiResponse({ status: 200, description: '返回管理员列表' })
  list(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.getAdminUsers(query)
  }

  @Post()
  @RequirePermissions('user:status')
  @ApiOperation({ summary: '创建管理员' })
  @ApiResponse({ status: 201, description: '管理员创建成功' })
  @ApiResponse({ status: 400, description: 'KB911 用户名已存在' })
  create(
    @Body() dto: CreateAdminUserDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.adminService.createAdminUser({
      username: dto.username,
      password: dto.password,
      role: dto.role,
      nickname: dto.nickname,
    })
  }

  @Put(':id')
  @RequirePermissions('user:status')
  @ApiOperation({ summary: '更新管理员信息' })
  @ApiResponse({ status: 200, description: '更新成功' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.adminService.updateAdminUser(id, dto, admin.sub)
  }

  @Delete(':id')
  @RequirePermissions('user:status')
  @ApiOperation({ summary: '删除管理员' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 400, description: 'KB912 不能删除自己' })
  delete(
    @Param('id') id: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.adminService.deleteAdminUser(id, admin.sub)
  }

  @Post(':id/reset-password')
  @RequirePermissions('user:status')
  @ApiOperation({ summary: '重置管理员密码' })
  @ApiResponse({ status: 200, description: '密码已重置' })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetAdminPasswordDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    return this.adminService.resetAdminPassword(id, dto.newPassword, admin.sub)
  }
}
