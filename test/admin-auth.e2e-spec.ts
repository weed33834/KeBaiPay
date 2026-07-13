import { Test } from '@nestjs/testing'
import { ValidationPipe, INestApplication, ExecutionContext } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { ConfigModule } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import request from 'supertest'
import { AdminAuthController } from '../src/admin/admin-auth.controller'
import { AdminAuthService } from '../src/admin/admin-auth.service'
import { AdminService } from '../src/admin/admin.service'
import { AdminJwtAuthGuard } from '../src/admin/admin-jwt-auth.guard'
import { AdminCurrentUser } from '../src/admin/admin-current-user.interface'

/**
 * AdminAuthController e2e 测试
 *
 * 之前缺失依赖：controller 构造函数需要 AdminService，change-password 端点用
 * AdminJwtAuthGuard（依赖 JwtService/ConfigService/PrismaService），均未提供。
 *
 * 修复策略：
 * - import ConfigModule + JwtModule 提供 JwtService/ConfigService
 * - mock AdminService（避免触发 PrismaService 真实查询）
 * - mock AdminJwtAuthGuard，canActivate 直接放行并注入 user，专注测 controller 逻辑
 */
describe('AdminAuthController (e2e)', () => {
  let app: INestApplication
  const mockAdminAuthService = {
    login: jest.fn().mockResolvedValue({ adminId: 'a1', token: 'token' }),
  }
  const mockAdminService = {
    changeAdminPassword: jest.fn().mockResolvedValue(undefined),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(),
        ConfigModule.forRoot(),
        JwtModule.register({ secret: 'test-secret' }),
      ],
      controllers: [AdminAuthController],
      providers: [
        { provide: AdminAuthService, useValue: mockAdminAuthService },
        { provide: AdminService, useValue: mockAdminService },
      ],
    })
      // overrideGuard：用 mock 替换真实 AdminJwtAuthGuard，
      // 放行所有请求并注入 mock user，避免依赖 PrismaService 真实查询
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest()
          req.user = { sub: 'a1', username: 'admin', role: 'SUPER_ADMIN' } as AdminCurrentUser
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /admin/auth/login', () => {
    it('缺少密码返回 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ username: 'admin' })
        .expect(400)

      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('password')]),
      )
    })

    it('参数合法返回 201', async () => {
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ username: 'admin', password: 'password' })
        .expect(201)

      expect(mockAdminAuthService.login).toHaveBeenCalled()
    })
  })

  describe('POST /admin/auth/change-password', () => {
    it('缺少 newPassword 返回 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/auth/change-password')
        .set('Authorization', 'Bearer fake-token')
        .send({ oldPassword: 'old' })
        .expect(400)

      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('newPassword')]),
      )
    })

    it('参数合法返回 201', async () => {
      await request(app.getHttpServer())
        .post('/admin/auth/change-password')
        .set('Authorization', 'Bearer fake-token')
        .send({ oldPassword: 'old123', newPassword: 'new123456' })
        .expect(201)

      // changeAdminPassword 现在透传 auditMeta（ip + userAgent）做审计上下文
      expect(mockAdminService.changeAdminPassword).toHaveBeenCalledWith(
        'a1',
        'old123',
        'new123456',
        expect.objectContaining({ ip: expect.any(String) }),
      )
    })
  })
})
