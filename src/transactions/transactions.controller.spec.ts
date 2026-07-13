import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { TransactionsController } from './transactions.controller'
import { TransactionsService } from './transactions.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * TransactionsController 单元测试
 *
 * 覆盖点：
 * - POST /transactions/recharge 参数校验 + 调用 service 透传
 * - @CurrentUser 装饰器注入的 user.id 正确传递
 */
describe('TransactionsController', () => {
  let controller: TransactionsController
  const mockService = {
    recharge: jest.fn().mockResolvedValue({
      orderNo: 'R20260713001',
      channelOrderNo: 'CH001',
      status: 'PENDING',
      payUrl: 'https://pay.example.com/r001',
    }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(TransactionsController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  describe('recharge 方法调用', () => {
    it('正确透传 user.id / amount / payPassword / idempotencyKey 到 service', async () => {
      const user = { id: 'u1' }
      const dto = { amount: 100, payPassword: '123456', idempotencyKey: 'idem-1' }
      await controller.recharge(user as any, dto as any)

      expect(mockService.recharge).toHaveBeenCalledWith('u1', 100, '123456', 'idem-1')
    })

    it('无 idempotencyKey 时透传 undefined', async () => {
      const user = { id: 'u2' }
      const dto = { amount: 50, payPassword: '654321' }
      await controller.recharge(user as any, dto as any)

      expect(mockService.recharge).toHaveBeenCalledWith('u2', 50, '654321', undefined)
    })
  })
})

/**
 * recharge 端点的 HTTP 层参数校验（用 supertest 跑 ValidationPipe）
 */
describe('TransactionsController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = { recharge: jest.fn().mockResolvedValue({ orderNo: 'R001' }) }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: mockService }],
    })
      // mock 掉 JwtAuthGuard，避免依赖 Passport 'jwt' 策略
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

  it('amount 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/transactions/recharge')
      .send({ payPassword: '123456' })
      .expect(400)
  })

  it('amount 非正数返回 400', () => {
    return request(app.getHttpServer())
      .post('/transactions/recharge')
      .send({ amount: -1, payPassword: '123456' })
      .expect(400)
  })

  it('payPassword 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/transactions/recharge')
      .send({ amount: 100 })
      .expect(400)
  })

  it('参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/transactions/recharge')
      .send({ amount: 100, payPassword: '123456' })
      .expect(201)
  })
})
