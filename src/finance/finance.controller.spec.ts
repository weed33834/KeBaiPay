import { Test } from '@nestjs/testing'
import { FinanceController } from './finance.controller'
import { FinanceService } from './finance.service'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'

describe('FinanceController', () => {
  let controller: FinanceController
  const mockFinanceService = {
    getOverview: jest.fn().mockResolvedValue({ totalRevenue: 100 }),
    getDailySummary: jest.fn().mockResolvedValue([{ date: '2026-01-01' }]),
    exportDailySummary: jest.fn().mockResolvedValue('date,revenue\n2026-01-01,100'),
    generateDailySnapshot: jest.fn().mockResolvedValue({ date: '2026-01-01' }),
    runManualSettlement: jest.fn().mockResolvedValue({ settled: 5 }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [{ provide: FinanceService, useValue: mockFinanceService }],
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
    controller = moduleRef.get(FinanceController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('getOverview 透传 query', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-01-31' }
    await controller.getOverview(query as any)
    expect(mockFinanceService.getOverview).toHaveBeenCalledWith(query)
  })

  it('getDailySummary 透传 query', async () => {
    const query = { startDate: '2026-01-01' }
    await controller.getDailySummary(query as any)
    expect(mockFinanceService.getDailySummary).toHaveBeenCalledWith(query)
  })

  it('exportDailySummary 写 CSV 头并通过 res.send 返回', async () => {
    const query = { startDate: '2026-01-01' }
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    }
    await controller.exportDailySummary(query as any, res as any)
    expect(mockFinanceService.exportDailySummary).toHaveBeenCalledWith(query)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="daily-summary.csv"',
    )
    expect(res.send).toHaveBeenCalledWith('date,revenue\n2026-01-01,100')
  })

  it('generateSnapshot 透传 date 到 generateDailySnapshot', async () => {
    const dto = { date: '2026-01-01' }
    await controller.generateSnapshot(dto as any)
    expect(mockFinanceService.generateDailySnapshot).toHaveBeenCalledWith('2026-01-01')
  })

  it('runSettlement 调用 runManualSettlement', async () => {
    await controller.runSettlement()
    expect(mockFinanceService.runManualSettlement).toHaveBeenCalledWith()
  })
})
