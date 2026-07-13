import { Test } from '@nestjs/testing'
import { AdminUserController } from './admin-user.controller'
import { AdminService } from './admin.service'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'

describe('AdminUserController', () => {
  let controller: AdminUserController
  const mockAdminService = {
    getAdminUsers: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    createAdminUser: jest.fn().mockResolvedValue({ id: 'a2' }),
    updateAdminUser: jest.fn().mockResolvedValue({ id: 'a2' }),
    deleteAdminUser: jest.fn().mockResolvedValue({ success: true }),
    resetAdminPassword: jest.fn().mockResolvedValue({ success: true }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUserController],
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
    controller = moduleRef.get(AdminUserController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('list 透传 query 到 getAdminUsers', async () => {
    const query = { page: 1, limit: 10 }
    await controller.list(query as any)
    expect(mockAdminService.getAdminUsers).toHaveBeenCalledWith(query)
  })

  it('create 透传 dto 字段到 createAdminUser', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { username: 'newadmin', password: '12345678', role: 'FINANCE', nickname: '财务' }
    await controller.create(dto as any, admin as any)
    expect(mockAdminService.createAdminUser).toHaveBeenCalledWith({
      username: 'newadmin',
      password: '12345678',
      role: 'FINANCE',
      nickname: '财务',
    })
  })

  it('update 透传 id/dto/sub 到 updateAdminUser', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { nickname: '新昵称' }
    await controller.update('a2', dto as any, admin as any)
    expect(mockAdminService.updateAdminUser).toHaveBeenCalledWith('a2', dto, 'a1')
  })

  it('delete 透传 id/sub 到 deleteAdminUser', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    await controller.delete('a2', admin as any)
    expect(mockAdminService.deleteAdminUser).toHaveBeenCalledWith('a2', 'a1')
  })

  it('resetPassword 透传 id/newPassword/sub 到 resetAdminPassword', async () => {
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const dto = { newPassword: '87654321' }
    await controller.resetPassword('a2', dto as any, admin as any)
    expect(mockAdminService.resetAdminPassword).toHaveBeenCalledWith('a2', '87654321', 'a1')
  })
})
