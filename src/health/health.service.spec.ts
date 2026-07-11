import { Test, TestingModule } from '@nestjs/testing'
import { HealthService } from './health.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

describe('HealthService', () => {
  let service: HealthService
  let prisma: { $queryRaw: jest.Mock }
  let redis: { isEnabled: jest.Mock; ping: jest.Mock }

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]) }
    redis = { isEnabled: jest.fn().mockReturnValue(true), ping: jest.fn().mockResolvedValue('PONG') }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(HealthService)
  })

  describe('liveness', () => {
    it('进程存活时返回 ok', () => {
      const result = service.liveness()
      expect(result.status).toBe('ok')
      expect(result.uptime).toBeGreaterThanOrEqual(0)
      expect(result.timestamp).toBeTruthy()
      expect(result.checks).toEqual({})
    })
  })

  describe('readiness', () => {
    it('DB 与 Redis 均正常时返回 ok', async () => {
      const result = await service.readiness()
      expect(result.status).toBe('ok')
      expect(result.timestamp).toBeTruthy()
      // 对外不暴露依赖细节（checks / latency / message）
      expect(Object.keys(result).sort()).toEqual(['status', 'timestamp'])
    })

    it('数据库异常时返回 error', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
      const result = await service.readiness()
      expect(result.status).toBe('error')
      // 对外不暴露具体错误消息
      expect(Object.keys(result).sort()).toEqual(['status', 'timestamp'])
    })

    it('Redis 异常时返回 error', async () => {
      redis.ping.mockRejectedValue(new Error('redis down'))
      const result = await service.readiness()
      expect(result.status).toBe('error')
    })

    it('Redis 未配置时降级为 ok', async () => {
      redis.isEnabled.mockReturnValue(false)
      const result = await service.readiness()
      expect(result.status).toBe('ok')
    })

    it('对外不暴露依赖延迟与错误消息细节', async () => {
      const result = await service.readiness()
      // readiness 仅返回 status + timestamp，不包含 checks/latency/message
      expect(Object.keys(result).sort()).toEqual(['status', 'timestamp'])
    })
  })
})
