import { AdminRole } from '../common/enums'

export interface AdminCurrentUser {
  sub: string
  role: AdminRole
}
