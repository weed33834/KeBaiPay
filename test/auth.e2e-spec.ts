import { Test } from '@nestjs/testing'
import { ValidationPipe, INestApplication } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { AuthController } from '../src/auth/auth.controller'
import { AuthService } from '../src/auth/auth.service'

describe('AuthController (e2e)', () => {
  let app: INestApplication
  const mockAuthService = {
    register: jest.fn().mockResolvedValue({ id: 'u1', token: 'token' }),
    login: jest.fn().mockResolvedValue({ id: 'u1', token: 'token' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot()],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
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

  it('POST /auth/register 缺少密码返回 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ nickname: 'test', email: 'test@example.com' })
      .expect(400)

    expect(response.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('password')]),
    )
  })

  it('POST /auth/register 参数合法返回 201', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ nickname: 'test', email: 'test@example.com', password: 'Test1234' })
      .expect(201)

    expect(mockAuthService.register).toHaveBeenCalled()
  })
})
