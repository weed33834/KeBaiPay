import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * UsersController 单元测试
 *
 * 覆盖点：
 * - 各方法透传 user.id 和 dto 到 service
 * - HTTP 层 DTO 参数校验
 */
describe('UsersController', () => {
  let controller: UsersController
  const mockService = {
    getSafeProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
    verifyIdentity: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    resetPayPassword: jest.fn().mockResolvedValue({ id: 'u1' }),
    getDailyLimit: jest.fn().mockResolvedValue({ limitYuan: '5000.00' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(UsersController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('me 透传 user.id 到 service', async () => {
    const user = { id: 'u1' }
    await controller.me(user as any)

    expect(mockService.getSafeProfile).toHaveBeenCalledWith('u1')
  })

  it('verifyIdentity 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = { realName: '张三', idCard: '110101199003073847', payPassword: '123456' }
    await controller.verifyIdentity(user as any, dto as any)

    expect(mockService.verifyIdentity).toHaveBeenCalledWith('u1', dto)
  })

  it('resetPayPassword 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = { realName: '张三', idCard: '110101199003073847', newPayPassword: '654321' }
    await controller.resetPayPassword(user as any, dto as any)

    expect(mockService.resetPayPassword).toHaveBeenCalledWith('u1', dto)
  })

  it('getDailyLimit 透传 user.id 到 service', async () => {
    const user = { id: 'u1' }
    await controller.getDailyLimit(user as any)

    expect(mockService.getDailyLimit).toHaveBeenCalledWith('u1')
  })
})

/**
 * HTTP 层参数校验
 */
describe('UsersController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    getSafeProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
    verifyIdentity: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    resetPayPassword: jest.fn().mockResolvedValue({ id: 'u1' }),
    getDailyLimit: jest.fn().mockResolvedValue({ limitYuan: '5000.00' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 'u1' }
          return true
        },
      })
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('GET /users/me 返回 200', () => {
    return request(app.getHttpServer()).get('/users/me').expect(200)
  })

  it('GET /users/daily-limit 返回 200', () => {
    return request(app.getHttpServer()).get('/users/daily-limit').expect(200)
  })

  it('verify-identity 缺 realName 返回 400', () => {
    return request(app.getHttpServer())
      .post('/users/verify-identity')
      .send({ idCard: '110101199003073847', payPassword: '123456' })
      .expect(400)
  })

  it('verify-identity 缺 idCard 返回 400', () => {
    return request(app.getHttpServer())
      .post('/users/verify-identity')
      .send({ realName: '张三', payPassword: '123456' })
      .expect(400)
  })

  it('verify-identity 缺 payPassword 返回 400', () => {
    return request(app.getHttpServer())
      .post('/users/verify-identity')
      .send({ realName: '张三', idCard: '110101199003073847' })
      .expect(400)
  })

  it('verify-identity payPassword 非数字返回 400', () => {
    return request(app.getHttpServer())
      .post('/users/verify-identity')
      .send({ realName: '张三', idCard: '110101199003073847', payPassword: 'abcdef' })
      .expect(400)
  })

  it('verify-identity 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/users/verify-identity')
      .send({ realName: '张三', idCard: '110101199003073847', payPassword: '123456' })
      .expect(201)
  })

  it('reset-pay-password 缺 newPayPassword 返回 400', () => {
    return request(app.getHttpServer())
      .post('/users/reset-pay-password')
      .send({ realName: '张三', idCard: '110101199003073847' })
      .expect(400)
  })

  it('reset-pay-password newPayPassword 长度非 6 位返回 400', () => {
    return request(app.getHttpServer())
      .post('/users/reset-pay-password')
      .send({ realName: '张三', idCard: '110101199003073847', newPayPassword: '12345' })
      .expect(400)
  })

  it('reset-pay-password 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/users/reset-pay-password')
      .send({ realName: '张三', idCard: '110101199003073847', newPayPassword: '654321' })
      .expect(201)
  })
})
