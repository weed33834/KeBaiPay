import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { CurrentUser as CurrentUserType } from './current-user.interface'

export const CurrentUser = createParamDecorator<unknown, CurrentUserType>(
  (data, ctx) => {
    const request = ctx.switchToHttp().getRequest()
    return request.user
  },
)
