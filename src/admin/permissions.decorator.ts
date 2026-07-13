import { SetMetadata } from '@nestjs/common'
import type { AdminRole } from '../common/enums'

export type Permission =
  | 'account:adjust'
  | 'withdrawal:audit'
  | 'reconciliation:run'
  | 'finance:view'
  | 'identity:audit'
  | 'merchant:audit'
  | 'user:status'
  | 'risk:config'
  | 'risk:event:handle'
  | 'admin:view'

export const PERMISSIONS_KEY = 'permissions'

/**
 * 各角色对应的细粒度权限映射
 *
 * - SUPER_ADMIN 拥有所有权限
 * - 其他角色仅拥有各自职能范围内的权限
 * - admin:view 为通用查询权限，所有后台角色均可读管理后台基础数据
 */
export const ROLE_PERMISSIONS: Record<AdminRole, Permission[] | '*'> = {
  SUPER_ADMIN: '*',
  FINANCE: [
    'account:adjust',
    'withdrawal:audit',
    'reconciliation:run',
    'finance:view',
    'admin:view',
  ],
  CUSTOMER_SERVICE: ['identity:audit', 'merchant:audit', 'user:status', 'admin:view'],
  RISK_OFFICER: ['risk:config', 'risk:event:handle', 'admin:view'],
}

/**
 * 校验某角色是否拥有指定权限
 */
export function hasPermission(role: AdminRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role]
  if (permissions === '*') {
    return true
  }
  return permissions.includes(permission)
}

/**
 * 端点声明所需权限；通过 PermissionsGuard 在运行时校验 JWT 中的 role
 *
 * 多个权限为 OR 关系：拥有其中任一即可通过
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions)
