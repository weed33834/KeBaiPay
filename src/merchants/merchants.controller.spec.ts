import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { MerchantsController } from './merchants.controller'
import { MerchantsService } from './merchants.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * MerchantsController 单元测试
 *
 * 覆盖点：
 * - 各方法透传 user.id 和 dto/param 到 service
 * - HTTP 层 DTO 参数校验
 */
describe('MerchantsController', () => {
  let controller: MerchantsController
  const mockService = {
    register: jest.fn().mockResolvedValue({ id: 'm1' }),
    getMyMerchant: jest.fn().mockResolvedValue({ id: 'm1' }),
    updateMyMerchant: jest.fn().mockResolvedValue({ id: 'm1' }),
    createApp: jest.fn().mockResolvedValue({ appId: 'a1', appSecret: 's1' }),
    listApps: jest.fn().mockResolvedValue([]),
    regenerateSecret: jest.fn().mockResolvedValue({ appSecret: 's2' }),
    getDashboard: jest.fn().mockResolvedValue({ todayAmount: 0 }),
    createQrCode: jest.fn().mockResolvedValue({ id: 'q1' }),
    listMyQrCodes: jest.fn().mockResolvedValue([]),
    deleteQrCode: jest.fn().mockResolvedValue({ ok: true }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MerchantsController],
      providers: [{ provide: MerchantsService, useValue: mockService }],
    }).compile()
    controller = moduleRef.get(MerchantsController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('register 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = { merchantName: '小店', merchantType: 'PERSONAL' as any }
    await controller.register(user as any, dto)
    expect(mockService.register).toHaveBeenCalledWith('u1', dto)
  })

  it('getMyMerchant 透传 user.id 到 service', async () => {
    await controller.getMyMerchant({ id: 'u1' } as any)
    expect(mockService.getMyMerchant).toHaveBeenCalledWith('u1')
  })

  it('updateMyMerchant 透传 user.id 和 dto 到 service', async () => {
    const dto = { merchantName: '改名' }
    await controller.updateMyMerchant({ id: 'u1' } as any, dto as any)
    expect(mockService.updateMyMerchant).toHaveBeenCalledWith('u1', dto)
  })

  it('createApp 透传 user.id 和 dto 到 service', async () => {
    const dto = { name: 'App1', callbackUrl: 'https://x.com/cb' }
    await controller.createApp({ id: 'u1' } as any, dto as any)
    expect(mockService.createApp).toHaveBeenCalledWith('u1', dto)
  })

  it('listApps 透传 user.id 到 service', async () => {
    await controller.listApps({ id: 'u1' } as any)
    expect(mockService.listApps).toHaveBeenCalledWith('u1')
  })

  it('regenerateSecret 透传 user.id 和 appId 到 service', async () => {
    await controller.regenerateSecret({ id: 'u1' } as any, 'app-1')
    expect(mockService.regenerateSecret).toHaveBeenCalledWith('u1', 'app-1')
  })

  it('getDashboard 透传 user.id 到 service', async () => {
    await controller.getDashboard({ id: 'u1' } as any)
    expect(mockService.getDashboard).toHaveBeenCalledWith('u1')
  })

  it('createQrCode 透传 user.id 和 dto 到 service', async () => {
    const dto = { amount: 9.9, remark: '咖啡' }
    await controller.createQrCode({ id: 'u1' } as any, dto as any)
    expect(mockService.createQrCode).toHaveBeenCalledWith('u1', dto)
  })

  it('listMyQrCodes 透传 user.id 到 service', async () => {
    await controller.listMyQrCodes({ id: 'u1' } as any)
    expect(mockService.listMyQrCodes).toHaveBeenCalledWith('u1')
  })

  it('deleteQrCode 透传 user.id 和 id 到 service', async () => {
    await controller.deleteQrCode({ id: 'u1' } as any, 'q-1')
    expect(mockService.deleteQrCode).toHaveBeenCalledWith('u1', 'q-1')
  })
})

/**
 * HTTP 层参数校验
 */
describe('MerchantsController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    register: jest.fn().mockResolvedValue({ id: 'm1' }),
    getMyMerchant: jest.fn().mockResolvedValue({ id: 'm1' }),
    updateMyMerchant: jest.fn().mockResolvedValue({ id: 'm1' }),
    createApp: jest.fn().mockResolvedValue({ appId: 'a1', appSecret: 's1' }),
    listApps: jest.fn().mockResolvedValue([]),
    regenerateSecret: jest.fn().mockResolvedValue({ appSecret: 's2' }),
    getDashboard: jest.fn().mockResolvedValue({ todayAmount: 0 }),
    createQrCode: jest.fn().mockResolvedValue({ id: 'q1' }),
    listMyQrCodes: jest.fn().mockResolvedValue([]),
    deleteQrCode: jest.fn().mockResolvedValue({ ok: true }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MerchantsController],
      providers: [{ provide: MerchantsService, useValue: mockService }],
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

  // register
  it('POST /merchants/register 缺 merchantName 返回 400', () => {
    return request(app.getHttpServer())
      .post('/merchants/register')
      .send({ contactName: '张三' })
      .expect(400)
  })

  it('POST /merchants/register 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/merchants/register')
      .send({ merchantName: '小店', merchantType: 'PERSONAL' })
      .expect(201)
  })

  // me
  it('GET /merchants/me 返回 200', () => {
    return request(app.getHttpServer()).get('/merchants/me').expect(200)
  })

  it('PATCH /merchants/me 返回 200', () => {
    return request(app.getHttpServer())
      .patch('/merchants/me')
      .send({ merchantName: '改名' })
      .expect(200)
  })

  // apps
  it('POST /merchants/apps 缺 name 返回 400', () => {
    return request(app.getHttpServer())
      .post('/merchants/apps')
      .send({ callbackUrl: 'https://x.com/cb' })
      .expect(400)
  })

  it('POST /merchants/apps 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/merchants/apps')
      .send({ name: 'App1', callbackUrl: 'https://x.com/cb' })
      .expect(201)
  })

  it('GET /merchants/apps 返回 200', () => {
    return request(app.getHttpServer()).get('/merchants/apps').expect(200)
  })

  it('POST /merchants/apps/:appId/regenerate-secret 返回 201', () => {
    return request(app.getHttpServer())
      .post('/merchants/apps/app-1/regenerate-secret')
      .expect(201)
  })

  // dashboard
  it('GET /merchants/dashboard 返回 200', () => {
    return request(app.getHttpServer()).get('/merchants/dashboard').expect(200)
  })

  // qrcodes
  it('POST /merchants/qrcodes 缺 amount 返回 400', () => {
    return request(app.getHttpServer())
      .post('/merchants/qrcodes')
      .send({ remark: '咖啡' })
      .expect(400)
  })

  it('POST /merchants/qrcodes amount 小于 0.01 返回 400', () => {
    return request(app.getHttpServer())
      .post('/merchants/qrcodes')
      .send({ amount: 0.001 })
      .expect(400)
  })

  it('POST /merchants/qrcodes 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/merchants/qrcodes')
      .send({ amount: 9.9, remark: '咖啡' })
      .expect(201)
  })

  it('GET /merchants/qrcodes 返回 200', () => {
    return request(app.getHttpServer()).get('/merchants/qrcodes').expect(200)
  })

  it('DELETE /merchants/qrcodes/:id 返回 200', () => {
    return request(app.getHttpServer()).delete('/merchants/qrcodes/q-1').expect(200)
  })
})
