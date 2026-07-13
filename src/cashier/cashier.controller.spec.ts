import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { CashierController, CashierQrCodeController } from './cashier.controller'
import { CashierService } from './cashier.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * CashierController 单元测试
 *
 * 覆盖点：
 * - 各方法透传 user.id / orderNo / dto / query 到 service
 * - export 端点写流到 Response
 */
describe('CashierController', () => {
  let controller: CashierController
  const mockService = {
    createOrder: jest.fn().mockResolvedValue({ orderNo: 'ORD1' }),
    listMyOrders: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    exportMyOrders: jest.fn().mockResolvedValue('csv,data\n1,2'),
    reconciliation: jest.fn().mockResolvedValue({ rows: [] }),
    getOrder: jest.fn().mockResolvedValue({ orderNo: 'ORD1' }),
    pay: jest.fn().mockResolvedValue({ ok: true }),
    retryNotify: jest.fn().mockResolvedValue({ ok: true }),
    getQrCodeOrderInfo: jest.fn().mockResolvedValue({ code: 'C1' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashierController],
      providers: [{ provide: CashierService, useValue: mockService }],
    }).compile()
    controller = moduleRef.get(CashierController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('createOrder 透传 user.id 和 dto 到 service', async () => {
    const dto = { merchantOrderNo: 'M1', amount: 9.9, subject: '咖啡' }
    await controller.createOrder({ id: 'u1' } as any, dto as any)
    expect(mockService.createOrder).toHaveBeenCalledWith('u1', dto)
  })

  it('listMyOrders 透传 user.id 和 query 到 service', async () => {
    const query = { status: 'PAID' as any, page: 1, limit: 10 }
    await controller.listMyOrders({ id: 'u1' } as any, query as any)
    expect(mockService.listMyOrders).toHaveBeenCalledWith('u1', query)
  })

  it('exportMyOrders 透传 user.id 和 query 到 service 并写流到 Response', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-01-31' }
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    }
    await controller.exportMyOrders({ id: 'u1' } as any, query as any, res as any)

    expect(mockService.exportMyOrders).toHaveBeenCalledWith('u1', query)
    // 验证 CSV 流写出
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="orders.csv"',
    )
    expect(res.send).toHaveBeenCalledWith('csv,data\n1,2')
  })

  it('reconciliation 透传 user.id 和 query 到 service', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-01-31' }
    await controller.reconciliation({ id: 'u1' } as any, query as any)
    expect(mockService.reconciliation).toHaveBeenCalledWith('u1', query)
  })

  it('getOrder 仅透传 orderNo 到 service', async () => {
    await controller.getOrder('ORD1')
    expect(mockService.getOrder).toHaveBeenCalledWith('ORD1')
  })

  it('pay 透传 user.id 和 {orderNo, payPassword} 到 service', async () => {
    await controller.pay({ id: 'u1' } as any, 'ORD1', { payPassword: '123456' } as any)
    expect(mockService.pay).toHaveBeenCalledWith('u1', {
      orderNo: 'ORD1',
      payPassword: '123456',
    })
  })

  it('retryNotify 透传 user.id 和 orderNo 到 service', async () => {
    await controller.retryNotify({ id: 'u1' } as any, 'ORD1')
    expect(mockService.retryNotify).toHaveBeenCalledWith('u1', 'ORD1')
  })
})

/**
 * CashierQrCodeController 单元测试
 * 公开接口，无 Guard
 */
describe('CashierQrCodeController', () => {
  let controller: CashierQrCodeController
  const mockService = {
    getQrCodeOrderInfo: jest.fn().mockResolvedValue({ code: 'C1' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashierQrCodeController],
      providers: [{ provide: CashierService, useValue: mockService }],
    }).compile()
    controller = moduleRef.get(CashierQrCodeController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('getQrCodeOrderInfo 透传 code 到 service', async () => {
    await controller.getQrCodeOrderInfo('CODE1')
    expect(mockService.getQrCodeOrderInfo).toHaveBeenCalledWith('CODE1')
  })
})

/**
 * CashierController HTTP 层参数校验
 */
describe('CashierController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    createOrder: jest.fn().mockResolvedValue({ orderNo: 'ORD1' }),
    listMyOrders: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    exportMyOrders: jest.fn().mockResolvedValue('csv,data\n1,2'),
    reconciliation: jest.fn().mockResolvedValue({ rows: [] }),
    getOrder: jest.fn().mockResolvedValue({ orderNo: 'ORD1' }),
    pay: jest.fn().mockResolvedValue({ ok: true }),
    retryNotify: jest.fn().mockResolvedValue({ ok: true }),
    getQrCodeOrderInfo: jest.fn().mockResolvedValue({ code: 'C1' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashierController],
      providers: [{ provide: CashierService, useValue: mockService }],
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

  // POST /cashier/orders
  it('POST /cashier/orders 缺 merchantOrderNo 返回 400', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders')
      .send({ amount: 9.9, subject: '咖啡' })
      .expect(400)
  })

  it('POST /cashier/orders 缺 subject 返回 400', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders')
      .send({ merchantOrderNo: 'M1', amount: 9.9 })
      .expect(400)
  })

  it('POST /cashier/orders amount 小于 0.01 返回 400', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders')
      .send({ merchantOrderNo: 'M1', amount: 0.001, subject: '咖啡' })
      .expect(400)
  })

  it('POST /cashier/orders amount 超过 500000 返回 400', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders')
      .send({ merchantOrderNo: 'M1', amount: 500001, subject: '咖啡' })
      .expect(400)
  })

  it('POST /cashier/orders 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders')
      .send({ merchantOrderNo: 'M1', amount: 9.9, subject: '咖啡' })
      .expect(201)
  })

  // GET /cashier/orders
  it('GET /cashier/orders 返回 200', () => {
    return request(app.getHttpServer()).get('/cashier/orders').expect(200)
  })

  it('GET /cashier/orders 带分页参数返回 200', () => {
    return request(app.getHttpServer())
      .get('/cashier/orders')
      .query({ page: 2, limit: 20 })
      .expect(200)
  })

  it('GET /cashier/orders?status=INVALID 返回 400', () => {
    return request(app.getHttpServer())
      .get('/cashier/orders')
      .query({ status: 'INVALID' })
      .expect(400)
  })

  it('GET /cashier/orders?startDate=invalid 返回 400', () => {
    return request(app.getHttpServer())
      .get('/cashier/orders')
      .query({ startDate: 'invalid' })
      .expect(400)
  })

  // export - @Res() 写流，仅校验 200 + Content-Type
  it('GET /cashier/orders/export 返回 200 且 Content-Type 为 csv', async () => {
    const res = await request(app.getHttpServer()).get('/cashier/orders/export').expect(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('orders.csv')
    expect(res.text).toContain('csv,data')
  })

  it('GET /cashier/orders/export?startDate=invalid 返回 400', () => {
    return request(app.getHttpServer())
      .get('/cashier/orders/export')
      .query({ startDate: 'invalid' })
      .expect(400)
  })

  // reconciliation
  it('GET /cashier/orders/reconciliation 返回 200', () => {
    return request(app.getHttpServer()).get('/cashier/orders/reconciliation').expect(200)
  })

  it('GET /cashier/orders/reconciliation 带日期范围返回 200', () => {
    return request(app.getHttpServer())
      .get('/cashier/orders/reconciliation')
      .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
      .expect(200)
  })

  it('GET /cashier/orders/reconciliation?startDate=invalid 返回 400', () => {
    return request(app.getHttpServer())
      .get('/cashier/orders/reconciliation')
      .query({ startDate: 'invalid' })
      .expect(400)
  })

  // :orderNo
  it('GET /cashier/orders/:orderNo 返回 200', () => {
    return request(app.getHttpServer()).get('/cashier/orders/ORD1').expect(200)
  })

  // pay
  it('POST /cashier/orders/:orderNo/pay 缺 payPassword 返回 400', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders/ORD1/pay')
      .send({})
      .expect(400)
  })

  it('POST /cashier/orders/:orderNo/pay payPassword 为空返回 400', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders/ORD1/pay')
      .send({ payPassword: '' })
      .expect(400)
  })

  it('POST /cashier/orders/:orderNo/pay 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/cashier/orders/ORD1/pay')
      .send({ payPassword: '123456' })
      .expect(201)
  })

  // notify
  it('POST /cashier/orders/:orderNo/notify 返回 201', () => {
    return request(app.getHttpServer()).post('/cashier/orders/ORD1/notify').expect(201)
  })
})

/**
 * CashierQrCodeController HTTP 层
 * 公开接口，无 Guard，无需 overrideGuard
 */
describe('CashierQrCodeController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    getQrCodeOrderInfo: jest.fn().mockResolvedValue({ code: 'C1', amount: 9.9 }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashierQrCodeController],
      providers: [{ provide: CashierService, useValue: mockService }],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('GET /cashier/qrcode/:code 无需鉴权返回 200', async () => {
    const res = await request(app.getHttpServer()).get('/cashier/qrcode/CODE1').expect(200)
    expect(res.body.code).toBe('C1')
  })
})
