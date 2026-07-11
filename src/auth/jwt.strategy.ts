import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { UsersService } from '../users/users.service'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { JWT_TOKEN_TYPE_USER } from '../common/constants'
import { CurrentUser } from './current-user.interface'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_USER_SECRET')!,
    })
  }

  async validate(payload: { sub: string; typ?: string }): Promise<CurrentUser> {
    // 校验 token 类型：仅允许 user token 通过 user 端鉴权。
    // 防止 JWT_USER_SECRET 与 JWT_ADMIN_SECRET 误配为相同值时，
    // admin token 被当 user token 使用。
    if (payload.typ !== JWT_TOKEN_TYPE_USER) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTH_FAILED))
    }
    const user = await this.usersService.findById(payload.sub)
    if (!user) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTH_FAILED))
    }
    if (user.status === 'FROZEN') {
      throw new UnauthorizedException(kbError(KBErrorCodes.ACCOUNT_FROZEN))
    }
    // 不返回敏感字段（如 loginPassword）给控制器
    const { loginPassword, ...safeUser } = user
    return safeUser
  }
}
