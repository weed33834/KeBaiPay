import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AdminRole } from '../common/enums'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { PERMISSIONS_KEY, hasPermission, type Permission } from './permissions.decorator'
import type { AdminCurrentUser } from './admin-current-user.interface'

/**
 * 细粒度权限校验守卫
 *
 * 基于 JWT payload 中的 role 查权限映射表，校验当前端点声明的所需权限。
 * 与 AdminJwtAuthGuard 组合使用：AdminJwtAuthGuard 负责认证，
 * PermissionsGuard 负责对带 @RequirePermissions() 的端点做权限校验。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || []

    if (requiredPermissions.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user: AdminCurrentUser | undefined = request.user
    if (!user) {
      throw new ForbiddenException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '缺少管理员身份信息'),
      )
    }

    const role = user.role as AdminRole
    const ok = requiredPermissions.some((p) => hasPermission(role, p))
    if (!ok) {
      throw new ForbiddenException(
        kbError(KBErrorCodes.FORBIDDEN, '当前角色无该操作权限'),
      )
    }
    return true
  }
}
