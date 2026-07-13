import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { TransfersController } from './transfers.controller'
import { TransfersService } from './transfers.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * TransfersController 单元测试
 *
 * 覆盖点：
 * - POST /transfers 参数校验 + service 调用透传
 * - @CurrentUser 注入的 user.id 正确传递
 */
describe('TransfersController', () => {
  let controller: TransfersController
  const mockService = {
    transfer: jest.fn().mockResolvedValue({ transactionId: 'T001' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [{ provide: TransfersService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(TransfersController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('transfer 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = {
      toUserId: 'u2',
      amount: 100,
      payPassword: '123456',
      remark: '测试',
      idempotencyKey: 'idem-1',
    }
    await controller.transfer(user as any, dto as any)

    expect(mockService.transfer).toHaveBeenCalledWith('u1', dto)
  })
})

/**
 * HTTP 层参数校验
 */
describe('TransfersController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = { transfer: jest.fn().mockResolvedValue({ transactionId: 'T001' }) }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [{ provide: TransfersService, useValue: mockService }],
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

  it('toUserId 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/transfers')
      .send({ amount: 100, payPassword: '123456' })
      .expect(400)
  })

  it('amount 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/transfers')
      .send({ toUserId: 'u2', payPassword: '123456' })
      .expect(400)
  })

  it('payPassword 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/transfers')
      .send({ toUserId: 'u2', amount: 100 })
      .expect(400)
  })

  it('参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/transfers')
      .send({ toUserId: 'u2', amount: 100, payPassword: '123456' })
      .expect(201)
  })
})
