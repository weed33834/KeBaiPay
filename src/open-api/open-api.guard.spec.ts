import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { createHmac, createHash } from 'crypto'
import { OpenApiGuard } from './open-api.guard'
import { RedisService } from '../redis/redis.service'
import { PrismaService } from '../prisma/prisma.service'

type PrismaMock = {
  merchantApp: Record<string, jest.Mock>
}
type RedisMock = Record<'isEnabled' | 'get' | 'set' | 'del', jest.Mock>

describe('OpenApiGuard', () => {
  let guard: OpenApiGuard
  let prisma: PrismaMock
  let redis: RedisMock

  const appId = 'app_123'
  const appSecret = 'secret_123'
  // DB 仅存 SHA-256 哈希；客户端需先对明文取哈希再作为 HMAC 密钥
  const appSecretHash = createHash('sha256').update(appSecret).digest('hex')

  function buildSignString(
    method: string,
    path: string,
    rawBody: string,
    timestamp: string,
    nonce: string,
  ) {
    return `${method}\n${path}\n${rawBody}\n${timestamp}\n${nonce}\n${appId}`
  }

  function sign(
    method: string,
    path: string,
    rawBody: string,
    timestamp: string,
    nonce: string,
  ) {
    return createHmac('sha256', appSecretHash)
      .update(buildSignString(method, path, rawBody, timestamp, nonce))
      .digest('hex')
  }

  function createContext(headers: Record<string, string>, rawBody = '{}', path = '/open-api/pay') {
    const request: Record<string, unknown> = {
      headers,
      method: 'POST',
      path,
      rawBody: Buffer.from(rawBody),
    }
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    prisma = {
      merchantApp: {
        findUnique: jest.fn(),
      },
    }
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as RedisMock
    guard = new OpenApiGuard(prisma as unknown as PrismaService, redis as unknown as RedisService)
  })

  it('缺少签名参数时拒绝', async () => {
    const ctx = createContext({})
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('时间戳无效时拒绝', async () => {
    const ctx = createContext({
      'x-app-id': appId,
      'x-timestamp': 'abc',
      'x-nonce': 'n1',
      'x-signature': 'sig',
    })
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('时间戳过期时拒绝', async () => {
    const oldTs = String(Date.now() - 3 * 60 * 1000)
    const ctx = createContext({
      'x-app-id': appId,
      'x-timestamp': oldTs,
      'x-nonce': 'n1',
      'x-signature': 'sig',
    })
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('未来时间戳超出容差时拒绝', async () => {
    const futureTs = String(Date.now() + 2 * 60 * 1000)
    const ctx = createContext({
      'x-app-id': appId,
      'x-timestamp': futureTs,
      'x-nonce': 'n1',
      'x-signature': 'sig',
    })
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('应用不存在时拒绝', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue(null)
    const ts = String(Date.now())
    const nonce = 'n1'
    const ctx = createContext(
      {
        'x-app-id': appId,
        'x-timestamp': ts,
        'x-nonce': nonce,
        'x-signature': sign('POST', '/open-api/pay', '{}', ts, nonce),
      },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('应用已禁用时拒绝', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue({ appId, appSecret: appSecretHash, status: 'DISABLED' })
    const ts = String(Date.now())
    const nonce = 'n1'
    const ctx = createContext(
      {
        'x-app-id': appId,
        'x-timestamp': ts,
        'x-nonce': nonce,
        'x-signature': sign('POST', '/open-api/pay', '{}', ts, nonce),
      },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException)
  })

  it('签名无效时拒绝', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue({ appId, appSecret: appSecretHash, status: 'ACTIVE' })
    const ts = String(Date.now())
    const ctx = createContext(
      {
        'x-app-id': appId,
        'x-timestamp': ts,
        'x-nonce': 'n1',
        'x-signature': 'invalid',
      },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('用明文密钥（而非 DB 哈希）签名时拒绝', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue({ appId, appSecret: appSecretHash, status: 'ACTIVE' })
    const ts = String(Date.now())
    const nonce = 'n1'
    // 客户端错误地用明文而非其哈希作为 HMAC 密钥，服务端用 DB 哈希校验应不匹配
    const wrongSig = createHmac('sha256', appSecret)
      .update(buildSignString('POST', '/open-api/pay', '{}', ts, nonce))
      .digest('hex')
    const ctx = createContext(
      {
        'x-app-id': appId,
        'x-timestamp': ts,
        'x-nonce': nonce,
        'x-signature': wrongSig,
      },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('签名正确且应用有效时通过', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue({ appId, appSecret: appSecretHash, status: 'ACTIVE' })
    const ts = String(Date.now())
    const nonce = 'n1'
    const ctx = createContext(
      {
        'x-app-id': appId,
        'x-timestamp': ts,
        'x-nonce': nonce,
        'x-signature': sign('POST', '/open-api/pay', '{}', ts, nonce),
      },
      '{}',
    )
    const result = await guard.canActivate(ctx)
    expect(result).toBe(true)
    expect((ctx.switchToHttp().getRequest() as { merchantApp: unknown }).merchantApp).toEqual({
      appId,
      appSecret: appSecretHash,
      status: 'ACTIVE',
    })
  })

  it('相同 nonce 在有效期内拒绝重放', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue({ appId, appSecret: appSecretHash, status: 'ACTIVE' })
    const ts = String(Date.now())
    const nonce = 'n1'
    const headers = {
      'x-app-id': appId,
      'x-timestamp': ts,
      'x-nonce': nonce,
      'x-signature': sign('POST', '/open-api/pay', '{}', ts, nonce),
    }

    const first = await guard.canActivate(createContext(headers, '{}'))
    expect(first).toBe(true)

    await expect(guard.canActivate(createContext(headers, '{}'))).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('签名基于 raw body，空白差异导致校验失败', async () => {
    prisma.merchantApp.findUnique.mockResolvedValue({ appId, appSecret: appSecretHash, status: 'ACTIVE' })
    const ts = String(Date.now())
    const nonce = 'n1'
    const body = '{"amount":100}'
    const headers = {
      'x-app-id': appId,
      'x-timestamp': ts,
      'x-nonce': nonce,
      'x-signature': sign('POST', '/open-api/pay', body, ts, nonce),
    }

    // 发送不同 raw body（带空格）
    await expect(guard.canActivate(createContext(headers, '{"amount": 100}'))).rejects.toThrow(
      UnauthorizedException,
    )
  })
})
