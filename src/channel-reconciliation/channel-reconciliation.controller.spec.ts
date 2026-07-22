import { Test } from '@nestjs/testing'
import { ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { ChannelReconciliationController } from './channel-reconciliation.controller'
import { ChannelReconciliationService } from './channel-reconciliation.service'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'

/**
 * ChannelReconciliationController 单元测试
 *
 * 覆盖点：
 * - 各方法透传参数到 service
 * - HTTP 层 DTO 校验（fetch / assign / resolve）
 */
describe('ChannelReconciliationController', () => {
  let controller: ChannelReconciliationController
  const mockService = {
    fetchStatement: jest.fn().mockResolvedValue({ id: 's1', status: 'FETCHED' }),
    listStatements: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getStatement: jest.fn().mockResolvedValue({ id: 's1', items: [] }),
    listStatementItems: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
    matchStatement: jest.fn().mockResolvedValue({
      statementId: 's1',
      matched: 0,
      mismatched: 0,
      unmatched: 0,
      missingInChannel: 0,
      totalDifferences: 0,
    }),
    listDifferences: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getDifference: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING' }),
    assignDifference: jest.fn().mockResolvedValue({ id: 'd1', status: 'INVESTIGATING' }),
    resolveDifference: jest.fn().mockResolvedValue({ id: 'd1', status: 'RESOLVED' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelReconciliationController],
      providers: [
        { provide: ChannelReconciliationService, useValue: mockService },
        { provide: PermissionsGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { sub: 'admin-1', role: 'SUPER_ADMIN' }
          return true
        },
      })
      .compile()

    controller = moduleRef.get(ChannelReconciliationController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('fetchStatement 透传 dto 和 admin.sub', async () => {
    const admin = { sub: 'admin-1', role: 'SUPER_ADMIN' }
    const dto = { channelCode: 'mock', date: '2026-07-21' }
    await controller.fetchStatement(dto as any, admin as any)

    expect(mockService.fetchStatement).toHaveBeenCalledWith(dto, 'admin-1')
  })

  it('listStatements 透传 query', async () => {
    const query = { channelCode: 'mock', page: 1, limit: 10 }
    await controller.listStatements(query as any)

    expect(mockService.listStatements).toHaveBeenCalledWith(query)
  })

  it('getStatement 透传 id', async () => {
    await controller.getStatement('s1')

    expect(mockService.getStatement).toHaveBeenCalledWith('s1')
  })

  it('listStatementItems 透传 id 和 query', async () => {
    const query = { page: 1, limit: 20 }
    await controller.listStatementItems('s1', query as any)

    expect(mockService.listStatementItems).toHaveBeenCalledWith('s1', query)
  })

  it('matchStatement 透传 id', async () => {
    await controller.matchStatement('s1')

    expect(mockService.matchStatement).toHaveBeenCalledWith('s1')
  })

  it('listDifferences 透传 query', async () => {
    const query = { page: 1, limit: 20 }
    await controller.listDifferences(query as any)

    expect(mockService.listDifferences).toHaveBeenCalledWith(query)
  })

  it('getDifference 透传 id', async () => {
    await controller.getDifference('d1')

    expect(mockService.getDifference).toHaveBeenCalledWith('d1')
  })

  it('assignDifference 透传 id 和 dto', async () => {
    const dto = { assignedTo: 'finance-1' }
    await controller.assignDifference('d1', dto as any)

    expect(mockService.assignDifference).toHaveBeenCalledWith('d1', dto)
  })

  it('resolveDifference 透传 id、dto 和 admin.sub', async () => {
    const admin = { sub: 'admin-1', role: 'SUPER_ADMIN' }
    const dto = { resolution: '已核实' }
    await controller.resolveDifference('d1', dto as any, admin as any)

    expect(mockService.resolveDifference).toHaveBeenCalledWith('d1', dto, 'admin-1')
  })
})

/**
 * HTTP 层参数校验
 */
describe('ChannelReconciliationController (HTTP)', () => {
  let app: import('@nestjs/common').INestApplication
  const mockService = {
    fetchStatement: jest.fn().mockResolvedValue({ id: 's1', status: 'FETCHED' }),
    listStatements: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getStatement: jest.fn().mockResolvedValue({ id: 's1', items: [] }),
    listStatementItems: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
    matchStatement: jest.fn().mockResolvedValue({
      statementId: 's1',
      matched: 0,
      mismatched: 0,
      unmatched: 0,
      missingInChannel: 0,
      totalDifferences: 0,
    }),
    listDifferences: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getDifference: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING' }),
    assignDifference: jest.fn().mockResolvedValue({ id: 'd1', status: 'INVESTIGATING' }),
    resolveDifference: jest.fn().mockResolvedValue({ id: 'd1', status: 'RESOLVED' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelReconciliationController],
      providers: [
        { provide: ChannelReconciliationService, useValue: mockService },
        { provide: PermissionsGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { sub: 'admin-1', role: 'SUPER_ADMIN' }
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

  it('GET /admin/channel-reconciliation/statements 返回 200', () => {
    return request(app.getHttpServer())
      .get('/admin/channel-reconciliation/statements')
      .expect(200)
  })

  it('GET /admin/channel-reconciliation/differences 返回 200', () => {
    return request(app.getHttpServer())
      .get('/admin/channel-reconciliation/differences')
      .expect(200)
  })

  it('fetchStatement 缺 channelCode 返回 400', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/statements/fetch')
      .send({ date: '2026-07-21' })
      .expect(400)
  })

  it('fetchStatement 日期格式非法返回 400', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/statements/fetch')
      .send({ channelCode: 'mock', date: 'not-a-date' })
      .expect(400)
  })

  it('fetchStatement 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/statements/fetch')
      .send({ channelCode: 'mock', date: '2026-07-21' })
      .expect(201)
  })

  it('matchStatement 返回 201', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/statements/s1/match')
      .expect(201)
  })

  it('assignDifference 缺 assignedTo 返回 400', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/differences/d1/assign')
      .send({})
      .expect(400)
  })

  it('assignDifference 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/differences/d1/assign')
      .send({ assignedTo: 'finance-1' })
      .expect(201)
  })

  it('resolveDifference 缺 resolution 返回 400', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/differences/d1/resolve')
      .send({})
      .expect(400)
  })

  it('resolveDifference 参数合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/differences/d1/resolve')
      .send({ resolution: '已核实' })
      .expect(201)
  })

  it('resolveDifference finalStatus=IGNORED 合法返回 201', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/differences/d1/resolve')
      .send({ resolution: '忽略', finalStatus: 'IGNORED' })
      .expect(201)
  })

  it('resolveDifference finalStatus 非法返回 400', () => {
    return request(app.getHttpServer())
      .post('/admin/channel-reconciliation/differences/d1/resolve')
      .send({ resolution: '测试', finalStatus: 'INVALID' })
      .expect(400)
  })
})
