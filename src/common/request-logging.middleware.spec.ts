import { Test } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { RequestLoggingMiddleware } from './request-logging.middleware'

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [RequestLoggingMiddleware],
    }).compile()
    middleware = module.get(RequestLoggingMiddleware)
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  function makeMockReqRes(statusCode = 200, headers: Record<string, string> = {}) {
    const req = {
      method: 'GET',
      originalUrl: '/health',
      ip: '127.0.0.1',
      headers: { ...headers },
    } as unknown as import('express').Request
    const res = {
      statusCode,
      setHeader: jest.fn(),
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') {
          // 立即触发 finish 回调以模拟请求结束
          process.nextTick(cb)
        }
      }),
    } as unknown as import('express').Response
    return { req, res }
  }

  it('生成 traceId 并写入响应头', (done) => {
    const { req, res } = makeMockReqRes()
    middleware.use(req, res, () => {
      expect(req.headers['x-request-id']).toBeTruthy()
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.headers['x-request-id'])
      done()
    })
  })

  it('复用上游传入的 X-Request-Id', (done) => {
    const { req, res } = makeMockReqRes(200, { 'x-request-id': 'upstream-trace-123' })
    middleware.use(req, res, () => {
      expect(req.headers['x-request-id']).toBe('upstream-trace-123')
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'upstream-trace-123')
      done()
    })
  })

  it('5xx 状态码记为 error', (done) => {
    const { req, res } = makeMockReqRes(500)
    middleware.use(req, res, () => {
      // 等待 finish 回调执行
      setTimeout(() => {
        expect(Logger.prototype.error).toHaveBeenCalled()
        done()
      }, 10)
    })
  })

  it('4xx 状态码记为 warn', (done) => {
    const { req, res } = makeMockReqRes(404)
    middleware.use(req, res, () => {
      setTimeout(() => {
        expect(Logger.prototype.warn).toHaveBeenCalled()
        done()
      }, 10)
    })
  })

  it('2xx 状态码记为 log', (done) => {
    const { req, res } = makeMockReqRes(200)
    middleware.use(req, res, () => {
      setTimeout(() => {
        expect(Logger.prototype.log).toHaveBeenCalled()
        done()
      }, 10)
    })
  })
})
