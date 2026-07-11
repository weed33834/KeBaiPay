import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { AdminRole } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { JWT_TOKEN_TYPE_ADMIN } from '../common/constants'
import { AdminCurrentUser } from './admin-current-user.interface'

const VALID_ROLES = new Set<string>(Object.values(AdminRole))

/** JWT payload 类型：在 AdminCurrentUser 基础上携带 typ 声明，用于区分 token 来源 */
type AdminJwtPayload = AdminCurrentUser & { typ?: string }

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '缺少管理员认证令牌'))
    }
    const token = authHeader.slice(7)
    let payload: AdminJwtPayload
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ADMIN_SECRET'),
      })
    } catch {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员令牌无效或已过期'))
    }
    // 校验 token 类型：仅允许 admin token 通过 admin 端鉴权。
    // 防止 JWT_USER_SECRET 与 JWT_ADMIN_SECRET 误配为相同值时，
    // user token 被当 admin token 使用。
    if (payload.typ !== JWT_TOKEN_TYPE_ADMIN) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员令牌无效或已过期'))
    }
    if (!VALID_ROLES.has(payload.role)) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '权限不足'))
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
    })
    if (!admin) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员账号不存在'))
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员已禁用'))
    }

    // H1-Sec: 使用 DB 中的最新 role 而非 JWT 中的 role，防止降权后权限残留
    request.user = { ...payload, role: admin.role }
    return true
  }
}
