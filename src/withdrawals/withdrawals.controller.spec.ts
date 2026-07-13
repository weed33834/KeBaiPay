import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { WithdrawalsController } from './withdrawals.controller'
import { WithdrawalsService } from './withdrawals.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * WithdrawalsController 单元测试
 *
 * 覆盖点：
 * - POST /withdrawals 参数校验 + service 调用透传
 * - GET /withdrawals 查询当前用户提现记录
 */
describe('WithdrawalsController', () => {
  let controller: WithdrawalsController
  const mockService = {
    create: jest.fn().mockResolvedValue({ orderNo: 'W001' }),
    findByUser: jest.fn().mockResolvedValue([{ orderNo: 'W001' }]),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WithdrawalsController],
      providers: [{ provide: WithdrawalsService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(WithdrawalsController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('create 透传 user.id 和 dto', async () => {
    const user = { id: 'u1' }
    const dto = { amount: 100, payPassword: '123456' }
    await controller.create(user as any, dto as any)

    expect(mockService.create).toHaveBeenCalledWith('u1', dto)
  })

  it('findByUser 透传 user.id', async () => {
    const user = { id: 'u1' }
    await controller.findByUser(user as any)

    expect(mockService.findByUser).toHaveBeenCalledWith('u1')
  })
})

/**
 * HTTP 层参数校验
 */
describe('WithdrawalsController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    create: jest.fn().mockResolvedValue({ orderNo: 'W001' }),
    findByUser: jest.fn().mockResolvedValue([]),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WithdrawalsController],
      providers: [{ provide: WithdrawalsService, useValue: mockService }],
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

  it('amount 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/withdrawals')
      .send({ payPassword: '123456' })
      .expect(400)
  })

  it('payPassword 缺失返回 400', () => {
    return request(app.getHttpServer())
      .post('/withdrawals')
      .send({ amount: 100 })
      .expect(400)
  })

  it('channelAccount 格式错误返回 400', () => {
    return request(app.getHttpServer())
      .post('/withdrawals')
      .send({ amount: 100, payPassword: '123456', channelAccount: '123' })
      .expect(400)
  })

  it('参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/withdrawals')
      .send({ amount: 100, payPassword: '123456' })
      .expect(201)
  })

  it('GET /withdrawals 返回 200', () => {
    return request(app.getHttpServer())
      .get('/withdrawals')
      .expect(200)
  })
})
