import { Test } from '@nestjs/testing'
import { ValidationPipe, INestApplication } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { AdminAuthController } from '../src/admin/admin-auth.controller'
import { AdminAuthService } from '../src/admin/admin-auth.service'

describe('AdminAuthController (e2e)', () => {
  let app: INestApplication
  const mockAdminAuthService = {
    login: jest.fn().mockResolvedValue({ adminId: 'a1', token: 'token' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot()],
      controllers: [AdminAuthController],
      providers: [{ provide: AdminAuthService, useValue: mockAdminAuthService }],
    }).compile()

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

  it('POST /admin/auth/login 缺少密码返回 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ username: 'admin' })
      .expect(400)

    expect(response.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('password')]),
    )
  })

  it('POST /admin/auth/login 参数合法返回 201', async () => {
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ username: 'admin', password: 'password' })
      .expect(201)

    expect(mockAdminAuthService.login).toHaveBeenCalled()
  })
})
