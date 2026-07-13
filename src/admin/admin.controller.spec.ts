import { Test } from '@nestjs/testing'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { MerchantsService } from '../merchants/merchants.service'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'

describe('AdminController', () => {
  let controller: AdminController
  const mockAdminService = {
    getDashboardStats: jest.fn().mockResolvedValue({ totalUsers: 10 }),
    listUsers: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    updateUserStatus: jest.fn().mockResolvedValue({ id: 'u1' }),
    approveIdentity: jest.fn().mockResolvedValue({ id: 'i1' }),
    rejectIdentity: jest.fn().mockResolvedValue({ id: 'i1' }),
    adjustAccount: jest.fn().mockResolvedValue({ success: true }),
    logAction: jest.fn().mockResolvedValue(undefined),
  }
  const mockWithdrawalsService = {
    approve: jest.fn().mockResolvedValue({ id: 'w1' }),
    reject: jest.fn().mockResolvedValue({ id: 'w1' }),
  }
  const mockMerchantsService = {}

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: WithdrawalsService, useValue: mockWithdrawalsService },
        { provide: MerchantsService, useValue: mockMerchantsService },
      ],
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
    controller = moduleRef.get(AdminController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('getDashboardStats 透传到 service', async () => {
    await controller.getDashboardStats()
    expect(mockAdminService.getDashboardStats).toHaveBeenCalledWith()
  })

  it('listUsers 透传 query', async () => {
    const query = { page: 1, limit: 10 }
    await controller.listUsers(query as any)
    expect(mockAdminService.listUsers).toHaveBeenCalledWith(query)
  })

  it('updateUserStatus 透传 id/status/reason/adminId', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { status: 'FROZEN', reason: '违规' }
    await controller.updateUserStatus('u1', dto as any, admin as any)
    expect(mockAdminService.updateUserStatus).toHaveBeenCalledWith('u1', 'FROZEN', '违规', 'a1')
  })

  it('approveWithdrawal 调用 approve 并记录审计', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    await controller.approveWithdrawal('w1', admin as any, req as any)
    expect(mockWithdrawalsService.approve).toHaveBeenCalledWith('w1', 'a1')
    expect(mockAdminService.logAction).toHaveBeenCalledWith(
      'a1',
      'WITHDRAWAL_AUDIT',
      'w1',
      { action: 'APPROVE' },
      { ip: '127.0.0.1', userAgent: 'jest' },
    )
  })

  it('rejectWithdrawal 调用 reject 并记录审计', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    const dto = { reason: '材料不全' }
    await controller.rejectWithdrawal('w1', dto as any, admin as any, req as any)
    expect(mockWithdrawalsService.reject).toHaveBeenCalledWith('w1', 'a1', '材料不全')
    expect(mockAdminService.logAction).toHaveBeenCalledWith(
      'a1',
      'WITHDRAWAL_AUDIT',
      'w1',
      { action: 'REJECT', reason: '材料不全' },
      { ip: '127.0.0.1', userAgent: 'jest' },
    )
  })

  it('approveIdentity 透传 id 和 adminId', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    await controller.approveIdentity('i1', admin as any)
    expect(mockAdminService.approveIdentity).toHaveBeenCalledWith('i1', 'a1')
  })

  it('rejectIdentity 透传 id/reason/adminId', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { reason: '照片模糊' }
    await controller.rejectIdentity('i1', dto as any, admin as any)
    expect(mockAdminService.rejectIdentity).toHaveBeenCalledWith('i1', '照片模糊', 'a1')
  })

  it('adjustAccount 透传 userId/amount/reason/adminId', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { amount: 100, reason: '补偿' }
    await controller.adjustAccount('u1', dto as any, admin as any)
    expect(mockAdminService.adjustAccount).toHaveBeenCalledWith('u1', 100, '补偿', 'a1')
  })
})
