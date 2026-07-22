import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { RedPacketsController } from './red-packets.controller'
import { RedPacketsService } from './red-packets.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * RedPacketsController 单元测试
 *
 * 覆盖点：
 * - 各方法透传 user.id / packetNo / idempotencyKey 到 service
 * - HTTP 层 DTO 参数校验
 */
describe('RedPacketsController', () => {
  let controller: RedPacketsController
  const mockService = {
    create: jest.fn().mockResolvedValue({ id: 'rp1' }),
    receive: jest.fn().mockResolvedValue({ id: 'rp1', status: 'RECEIVED' }),
    findSent: jest.fn().mockResolvedValue([]),
    findReceived: jest.fn().mockResolvedValue([]),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RedPacketsController],
      providers: [{ provide: RedPacketsService, useValue: mockService }],
    }).compile()

    controller = moduleRef.get(RedPacketsController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('create 透传 user.id 和 dto 到 service', async () => {
    const user = { id: 'u1' }
    const dto = { amount: 8.88, payPassword: '123456', remark: '恭喜' }
    await controller.create(user as any, dto as any)

    expect(mockService.create).toHaveBeenCalledWith('u1', dto)
  })

  it('receive 透传 user.id、packetNo、idempotencyKey 到 service', async () => {
    const user = { id: 'u1' }
    await controller.receive(user as any, 'RP001', { password: 'abc' }, 'idem-1')

    expect(mockService.receive).toHaveBeenCalledWith('u1', 'RP001', {
      idempotencyKey: 'idem-1',
      password: 'abc',
    })
  })

  it('receive idempotencyKey 缺省时透传 undefined', async () => {
    const user = { id: 'u1' }
    await controller.receive(user as any, 'RP001', {}, undefined)

    expect(mockService.receive).toHaveBeenCalledWith('u1', 'RP001', {
      idempotencyKey: undefined,
      password: undefined,
    })
  })

  it('findSent 透传 user.id 到 service', async () => {
    const user = { id: 'u1' }
    await controller.findSent(user as any)

    expect(mockService.findSent).toHaveBeenCalledWith('u1')
  })

  it('findReceived 透传 user.id 到 service', async () => {
    const user = { id: 'u1' }
    await controller.findReceived(user as any)

    expect(mockService.findReceived).toHaveBeenCalledWith('u1')
  })
})

/**
 * HTTP 层参数校验
 */
describe('RedPacketsController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    create: jest.fn().mockResolvedValue({ id: 'rp1' }),
    receive: jest.fn().mockResolvedValue({ id: 'rp1', status: 'RECEIVED' }),
    findSent: jest.fn().mockResolvedValue([]),
    findReceived: jest.fn().mockResolvedValue([]),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RedPacketsController],
      providers: [{ provide: RedPacketsService, useValue: mockService }],
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

  it('GET /red-packets/sent 返回 200', () => {
    return request(app.getHttpServer()).get('/red-packets/sent').expect(200)
  })

  it('GET /red-packets/received 返回 200', () => {
    return request(app.getHttpServer()).get('/red-packets/received').expect(200)
  })

  it('create 缺 amount 返回 400', () => {
    return request(app.getHttpServer())
      .post('/red-packets')
      .send({ payPassword: '123456' })
      .expect(400)
  })

  it('create 缺 payPassword 返回 400', () => {
    return request(app.getHttpServer())
      .post('/red-packets')
      .send({ amount: 8.88 })
      .expect(400)
  })

  it('create amount 为 0 返回 400', () => {
    return request(app.getHttpServer())
      .post('/red-packets')
      .send({ amount: 0, payPassword: '123456' })
      .expect(400)
  })

  it('create payPassword 超过 6 位返回 400', () => {
    return request(app.getHttpServer())
      .post('/red-packets')
      .send({ amount: 8.88, payPassword: '1234567' })
      .expect(400)
  })

  it('create 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/red-packets')
      .send({ amount: 8.88, payPassword: '123456', remark: '恭喜' })
      .expect(201)
  })

  it('receive 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/red-packets/RP001/receive')
      .expect(201)
  })

  it('receive 携带 idempotencyKey 返回 201', () => {
    return request(app.getHttpServer())
      .post('/red-packets/RP001/receive')
      .query({ idempotencyKey: 'idem-1' })
      .expect(201)
  })
})
