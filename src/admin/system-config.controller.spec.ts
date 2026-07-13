import { Test } from '@nestjs/testing'
import { SystemConfigController } from './system-config.controller'
import { AdminService } from './admin.service'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'

describe('SystemConfigController', () => {
  let controller: SystemConfigController
  const mockAdminService = {
    getSystemConfigs: jest.fn().mockResolvedValue([{ key: 'k1', value: 'v1' }]),
    getSystemConfigByKey: jest.fn().mockResolvedValue({ key: 'k1', value: 'v1' }),
    createSystemConfig: jest.fn().mockResolvedValue({ key: 'k1', value: 'v1' }),
    updateSystemConfig: jest.fn().mockResolvedValue({ key: 'k1', value: 'v2' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SystemConfigController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { sub: 'a1', username: 'admin', role: 'SUPER_ADMIN' }
          return true
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile()
    controller = moduleRef.get(SystemConfigController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('getAll 透传到 getSystemConfigs', async () => {
    await controller.getAll()
    expect(mockAdminService.getSystemConfigs).toHaveBeenCalledWith()
  })

  it('getByKey 透传 key', async () => {
    await controller.getByKey('risk_rule:max_amount')
    expect(mockAdminService.getSystemConfigByKey).toHaveBeenCalledWith('risk_rule:max_amount')
  })

  it('create 透传 key/value/sub/auditMeta', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    const dto = { key: 'risk_rule:max_amount', value: '10000' }
    await controller.create(dto as any, admin as any, req as any)
    expect(mockAdminService.createSystemConfig).toHaveBeenCalledWith(
      'risk_rule:max_amount',
      '10000',
      'a1',
      { ip: '127.0.0.1', userAgent: 'jest' },
    )
  })

  it('update 透传 key/value/sub/auditMeta', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    const dto = { key: 'risk_rule:max_amount', value: '20000' }
    await controller.update('risk_rule:max_amount', dto as any, admin as any, req as any)
    expect(mockAdminService.updateSystemConfig).toHaveBeenCalledWith(
      'risk_rule:max_amount',
      '20000',
      'a1',
      { ip: '127.0.0.1', userAgent: 'jest' },
    )
  })
})
