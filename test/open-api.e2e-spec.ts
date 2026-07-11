import { Test } from '@nestjs/testing'
import { ValidationPipe, INestApplication } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { ConfigModule } from '@nestjs/config'
import request from 'supertest'
import { OpenApiController } from '../src/open-api/open-api.controller'
import { OpenApiService } from '../src/open-api/open-api.service'
import { OpenApiGuard } from '../src/open-api/open-api.guard'
import { PrismaService } from '../src/prisma/prisma.service'
import { RedisService } from '../src/redis/redis.service'
import { RiskEngineService } from '../src/risk/risk-engine.service'

describe('OpenApiController (e2e)', () => {
  let app: INestApplication
  const mockPrisma = {
    merchantApp: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'app1',
        appId: 'app_xxx',
        appSecret: 'secret',
        merchantId: 'm1',
        status: 'ACTIVE',
      }),
    },
    merchant: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'm1',
        status: 'APPROVED',
        userId: 'u2',
      }),
    },
  }
  const mockRedis = {
    isEnabled: jest.fn().mockReturnValue(false),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  }
  const mockRiskEngine = {
    check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
  }
  const mockOpenApiService = {
    createOrder: jest.fn().mockResolvedValue({ orderNo: 'P1', amountYuan: '10.00' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(), ThrottlerModule.forRoot()],
      controllers: [OpenApiController],
      providers: [
        OpenApiGuard,
        { provide: OpenApiService, useValue: mockOpenApiService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: RiskEngineService, useValue: mockRiskEngine },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /open-api/v1/orders 缺少签名参数返回 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/open-api/v1/orders')
      .send({ merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      .expect(401)

    expect(response.body.message).toContain('KB401')
  })

  it('POST /open-api/v1/orders 带错误签名返回 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/open-api/v1/orders')
      .set('X-App-Id', 'app_xxx')
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .set('X-Signature', 'dummy')
      .send({ merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      .expect(401)

    expect(response.body.message).toContain('KB401')
  })
})
