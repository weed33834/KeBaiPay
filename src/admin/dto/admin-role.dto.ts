import { AdminRole } from '../../common/enums'
import type { Permission } from '../permissions.decorator'

/**
 * 角色定义
 */
export interface AdminRoleDefinition {
  value: AdminRole
  label: string
  description: string
  permissions: Permission[] | '*'
}

/**
 * 所有角色及其权限定义
 */
export const ADMIN_ROLE_DEFINITIONS: AdminRoleDefinition[] = [
  {
    value: AdminRole.SUPER_ADMIN,
    label: '超级管理员',
    description: '拥有系统全部权限，可管理所有功能和管理员',
    permissions: '*',
  },
  {
    value: AdminRole.FINANCE,
    label: '财务人员',
    description: '负责账户调账、提现审核、对账等财务相关操作',
    permissions: [
      'account:adjust',
      'withdrawal:audit',
      'reconciliation:run',
      'finance:view',
    ],
  },
  {
    value: AdminRole.CUSTOMER_SERVICE,
    label: '客服人员',
    description: '负责实名审核、商户审核、用户状态管理等客服相关操作',
    permissions: ['identity:audit', 'merchant:audit', 'user:status'],
  },
  {
    value: AdminRole.RISK_OFFICER,
    label: '风控人员',
    description: '负责风控规则配置、风险事件处理等风控相关操作',
    permissions: ['risk:config', 'risk:event:handle'],
  },
]

/**
 * 获取角色定义
 */
export function getRoleDefinition(role: AdminRole): AdminRoleDefinition | undefined {
  return ADMIN_ROLE_DEFINITIONS.find((r) => r.value === role)
}

/**
 * 获取角色权限
 */
export function getRolePermissions(role: AdminRole): Permission[] {
  const definition = getRoleDefinition(role)
  if (!definition) return []
  if (definition.permissions === '*') {
    return ['account:adjust', 'withdrawal:audit', 'reconciliation:run', 'finance:view', 'identity:audit', 'merchant:audit', 'user:status', 'risk:config', 'risk:event:handle']
  }
  return definition.permissions
}
