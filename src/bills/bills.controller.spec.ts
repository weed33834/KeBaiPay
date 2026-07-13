import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { BillsController } from './bills.controller'
import { BillsService } from './bills.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * BillsController 单元测试
 *
 * 覆盖点：
 * - list 透传 user.id 和 query.direction 到 service
 * - list 对每条账单执行 fenToYuan 转换
 */
describe('BillsController', () => {
  let controller: BillsController
  const mockService = {
    findByUser: jest.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BillsController],
      providers: [{ provide: BillsService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(BillsController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('list 透传 user.id 和 direction 到 service', async () => {
    mockService.findByUser.mockResolvedValue([])
    const user = { id: 'u1' }
    const query = { direction: 'INCOME' as any }
    await controller.list(user as any, query)

    expect(mockService.findByUser).toHaveBeenCalledWith('u1', 'INCOME')
  })

  it('list direction 为 undefined 时透传 undefined', async () => {
    mockService.findByUser.mockResolvedValue([])
    const user = { id: 'u1' }
    await controller.list(user as any, {} as any)

    expect(mockService.findByUser).toHaveBeenCalledWith('u1', undefined)
  })

  // 验证分→元转换：100 分 → "1.00" 元
  it('list 对每条账单执行 fenToYuan 转换', async () => {
    mockService.findByUser.mockResolvedValue([
      { id: 'b1', amount: 100 },
      { id: 'b2', amount: 105 },
    ])
    const result: any = await controller.list({ id: 'u1' } as any, {} as any)

    expect(result[0].amountYuan).toBe('1.00')
    expect(result[1].amountYuan).toBe('1.05')
  })

  it('list 空列表返回空数组', async () => {
    mockService.findByUser.mockResolvedValue([])
    const result = await controller.list({ id: 'u1' } as any, {} as any)

    expect(result).toEqual([])
  })
})

/**
 * HTTP 层
 */
describe('BillsController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    findByUser: jest.fn().mockResolvedValue([
      { id: 'b1', amount: 100 },
    ]),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BillsController],
      providers: [{ provide: BillsService, useValue: mockService }],
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

  it('GET /bills 返回 200 且含金额转换字段', async () => {
    const res = await request(app.getHttpServer()).get('/bills').expect(200)

    expect(res.body[0].amountYuan).toBe('1.00')
  })

  it('GET /bills?direction=INCOME 返回 200', () => {
    return request(app.getHttpServer()).get('/bills').query({ direction: 'INCOME' }).expect(200)
  })

  // direction 是 @IsEnum，非法值应被拦截
  it('GET /bills?direction=INVALID 返回 400', () => {
    return request(app.getHttpServer()).get('/bills').query({ direction: 'INVALID' }).expect(400)
  })
})
