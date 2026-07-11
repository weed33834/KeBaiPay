import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { AdminCurrentUser as AdminCurrentUserType } from './admin-current-user.interface'

export const AdminCurrentUser = createParamDecorator<unknown, AdminCurrentUserType>(
  (data, ctx) => {
    const request = ctx.switchToHttp().getRequest()
    return request.user
  },
)
