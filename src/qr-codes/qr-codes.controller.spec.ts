import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { QrCodesController } from './qr-codes.controller'
import { QrCodesService } from './qr-codes.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * QrCodesController 单元测试
 *
 * 覆盖点：
 * - 各方法透传 user.id 和 dto 到 service
 * - HTTP 层 DTO 参数校验
 */
describe('QrCodesController', () => {
  let controller: QrCodesController
  const mockService = {
    getPersonalCode: jest.fn().mockResolvedValue({ code: 'KB-xxx' }),
    createFixedCode: jest.fn().mockResolvedValue({ id: 'q1' }),
    pay: jest.fn().mockResolvedValue({ id: 't1' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QrCodesController],
      providers: [{ provide: QrCodesService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(QrCodesController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('getPersonalCode 透传 user.id 到 service', async () => {
    const user = { id: 'u1' }
    await controller.getPersonalCode(user as any)

    expect(mockService.getPersonalCode).toHaveBeenCalledWith('u1')
  })

  it('createFixedCode 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = { amount: 10.5, remark: '咖啡' }
    await controller.createFixedCode(user as any, dto as any)

    expect(mockService.createFixedCode).toHaveBeenCalledWith('u1', dto)
  })

  it('pay 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = { code: 'KB-xxx', amount: 10, payPassword: '123456', remark: '测试' }
    await controller.pay(user as any, dto as any)

    expect(mockService.pay).toHaveBeenCalledWith('u1', dto)
  })
})

/**
 * HTTP 层参数校验
 */
describe('QrCodesController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    getPersonalCode: jest.fn().mockResolvedValue({ code: 'KB-xxx' }),
    createFixedCode: jest.fn().mockResolvedValue({ id: 'q1' }),
    pay: jest.fn().mockResolvedValue({ id: 't1' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QrCodesController],
      providers: [{ provide: QrCodesService, useValue: mockService }],
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

  it('GET /qr-codes/personal 返回 200', () => {
    return request(app.getHttpServer()).get('/qr-codes/personal').expect(200)
  })

  it('fixed 缺 amount 返回 400', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/fixed')
      .send({ remark: '咖啡' })
      .expect(400)
  })

  it('fixed amount 为 0 返回 400', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/fixed')
      .send({ amount: 0 })
      .expect(400)
  })

  it('fixed amount 超出上限返回 400', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/fixed')
      .send({ amount: 500001 })
      .expect(400)
  })

  it('fixed 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/fixed')
      .send({ amount: 10.5, remark: '咖啡' })
      .expect(201)
  })

  it('pay 缺 code 返回 400', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/pay')
      .send({ payPassword: '123456' })
      .expect(400)
  })

  it('pay 缺 payPassword 返回 400', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/pay')
      .send({ code: 'KB-xxx' })
      .expect(400)
  })

  it('pay payPassword 超过 6 位返回 400', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/pay')
      .send({ code: 'KB-xxx', payPassword: '1234567' })
      .expect(400)
  })

  it('pay 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/qr-codes/pay')
      .send({ code: 'KB-xxx', amount: 10, payPassword: '123456' })
      .expect(201)
  })
})
