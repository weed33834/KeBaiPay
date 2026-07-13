import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AccountsController } from './accounts.controller'
import { AccountsService } from './accounts.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * AccountsController 单元测试
 *
 * 覆盖点：
 * - me 透传 user.id 到 service
 * - me 返回 null 时直接返回 null
 * - me 对金额字段执行 fenToYuan 转换
 */
describe('AccountsController', () => {
  let controller: AccountsController
  const mockService = {
    findByUserId: jest.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(AccountsController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('me 透传 user.id 到 service', async () => {
    mockService.findByUserId.mockResolvedValue(null)
    const user = { id: 'u1' }
    await controller.me(user as any)

    expect(mockService.findByUserId).toHaveBeenCalledWith('u1')
  })

  it('me 返回 null 时直接返回 null', async () => {
    mockService.findByUserId.mockResolvedValue(null)
    const result = await controller.me({ id: 'u1' } as any)

    expect(result).toBeNull()
  })

  // 验证分→元转换：101 分 → "1.01" 元，必须输出字符串避免浮点精度问题
  it('me 对金额字段执行 fenToYuan 转换', async () => {
    mockService.findByUserId.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      availableBalance: 101,
      frozenBalance: 202,
      totalBalance: 303,
      ledgers: [
        {
          id: 'l1',
          amount: 10,
          balanceBefore: 100,
          balanceAfter: 90,
        },
      ],
    })
    const result: any = await controller.me({ id: 'u1' } as any)

    expect(result.availableBalanceYuan).toBe('1.01')
    expect(result.frozenBalanceYuan).toBe('2.02')
    expect(result.totalBalanceYuan).toBe('3.03')
    expect(result.ledgers[0].amountYuan).toBe('0.10')
    expect(result.ledgers[0].balanceBeforeYuan).toBe('1.00')
    expect(result.ledgers[0].balanceAfterYuan).toBe('0.90')
  })

  // 账户存在但 ledgers 为空时不应抛错（map 兜底空数组）
  it('me ledgers 为空时返回空数组', async () => {
    mockService.findByUserId.mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      availableBalance: 0,
      frozenBalance: 0,
      totalBalance: 0,
      ledgers: [],
    })
    const result: any = await controller.me({ id: 'u1' } as any)

    expect(result.ledgers).toEqual([])
    expect(result.availableBalanceYuan).toBe('0.00')
  })
})

/**
 * HTTP 层
 */
describe('AccountsController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    findByUserId: jest.fn().mockResolvedValue({
      id: 'acc1',
      userId: 'u1',
      availableBalance: 100,
      frozenBalance: 0,
      totalBalance: 100,
      ledgers: [],
    }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: mockService }],
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

  it('GET /accounts/me 返回 200 且含金额转换字段', async () => {
    const res = await request(app.getHttpServer()).get('/accounts/me').expect(200)

    expect(res.body.availableBalanceYuan).toBe('1.00')
    expect(res.body.totalBalanceYuan).toBe('1.00')
  })
})
