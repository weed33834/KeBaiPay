import { Test } from '@nestjs/testing'
import { ReconciliationController } from './reconciliation.controller'
import { ReconciliationService } from './reconciliation.service'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'

describe('ReconciliationController', () => {
  let controller: ReconciliationController
  const mockReconciliationService = {
    runReconciliation: jest.fn().mockResolvedValue({ date: '2026-01-01', status: 'OK' }),
    getReports: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    exportReports: jest.fn().mockResolvedValue('date,status,diff\n2026-01-01,OK,'),
    getReport: jest.fn().mockResolvedValue({ date: '2026-01-01', status: 'OK' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReconciliationController],
      providers: [{ provide: ReconciliationService, useValue: mockReconciliationService }],
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
    controller = moduleRef.get(ReconciliationController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('runReconciliation 透传 date 和 admin.sub', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { date: '2026-01-01' }
    await controller.runReconciliation(dto as any, admin as any)
    expect(mockReconciliationService.runReconciliation).toHaveBeenCalledWith('2026-01-01', 'a1')
  })

  it('getReports 透传 query', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-01-31' }
    await controller.getReports(query as any)
    expect(mockReconciliationService.getReports).toHaveBeenCalledWith(query)
  })

  it('exportReports 写 CSV 头并通过 res.send 返回', async () => {
    const query = { startDate: '2026-01-01' }
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    }
    await controller.exportReports(query as any, res as any)
    expect(mockReconciliationService.exportReports).toHaveBeenCalledWith(query)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="reconciliation-reports.csv"',
    )
    expect(res.send).toHaveBeenCalledWith('date,status,diff\n2026-01-01,OK,')
  })

  it('getReport 透传 date', async () => {
    await controller.getReport('2026-01-01')
    expect(mockReconciliationService.getReport).toHaveBeenCalledWith('2026-01-01')
  })
})
