import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Request, Response } from 'express'
import { KBErrorCodes } from './error-codes'

/**
 * 全局异常过滤器：统一所有未捕获异常的响应格式，避免内部错误信息泄露。
 *
 * 处理顺序：
 * 1. HttpException：业务主动抛出的异常，透传 status + message
 * 2. PrismaClientKnownRequestError：DB 约束/不存在错误映射为业务错误码
 * 3. PrismaClientValidationError：DB 类型校验错误映射为 400
 * 4. 其他 Error：统一返回 500 KB001，生产环境剥离 stack
 *
 * 响应格式与 ResponseTransformInterceptor 保持一致：
 * { code: 'KBxxx', message: '...', data: null }
 * 异常路径不走 interceptor，故在此直接构造最终响应体。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter')
  private readonly isProduction = process.env.NODE_ENV === 'production'

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const traceId = (request.headers['x-request-id'] as string) || '-'

    const { status, payload } = this.resolve(exception, traceId)

    // 5xx 错误记录完整 stack 便于排查；4xx 错误仅记录摘要
    if (status >= 500) {
      this.logger.error(
        `[${traceId}] ${request.method} ${request.originalUrl} ${status} ${this.formatError(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      )
    } else {
      this.logger.warn(
        `[${traceId}] ${request.method} ${request.originalUrl} ${status} ${this.formatError(exception)}`,
      )
    }

    response.status(status).json(payload)
  }

  private resolve(
    exception: unknown,
    traceId: string,
  ): { status: number; payload: { code: string; message: string; data: null; traceId: string } } {
    // 1. 业务主动抛出的 HTTP 异常
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const resp = exception.getResponse()
      const message =
        typeof resp === 'string'
          ? resp
          : (resp as { message?: string | string[] }).message
      const messageStr = Array.isArray(message) ? message[0] : message || exception.message
      return {
        status,
        payload: {
          code: this.httpStatusToCode(status),
          message: messageStr,
          data: null,
          traceId,
        },
      }
    }

    // 2. Prisma 已知错误码：映射为业务异常，避免泄露表名/字段名
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaKnownError(exception)
      return {
        status: mapped.status,
        payload: { code: mapped.code, message: mapped.message, data: null, traceId },
      }
    }

    // 3. Prisma 校验错误（类型不匹配、必填字段缺失等）
    if (exception instanceof Prisma.PrismaClientValidationError) {
      // 生产环境不暴露具体字段名，仅返回通用提示
      const message = this.isProduction
        ? '请求参数类型或格式错误'
        : exception.message.slice(0, 200)
      return {
        status: HttpStatus.BAD_REQUEST,
        payload: { code: KBErrorCodes.UNKNOWN_ERROR, message, data: null, traceId },
      }
    }

    // 4. 未知错误：统一返回 500 KB001，绝不泄露内部信息
    const message = this.isProduction
      ? '系统内部错误，请稍后重试或联系客服'
      : (exception as Error)?.message || '未知错误'
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      payload: {
        code: KBErrorCodes.UNKNOWN_ERROR,
        message,
        data: null,
        traceId,
      },
    }
  }

  private mapPrismaKnownError(
    err: Prisma.PrismaClientKnownRequestError,
  ): { status: number; code: string; message: string } {
    switch (err.code) {
      case 'P2002':
        // 唯一约束冲突：返回 409，不暴露具体字段名
        return {
          status: HttpStatus.CONFLICT,
          code: KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT,
          message: '资源已存在或唯一约束冲突',
        }
      case 'P2025':
        // 记录不存在：返回 404
        return {
          status: HttpStatus.NOT_FOUND,
          code: KBErrorCodes.RESOURCE_NOT_FOUND,
          message: '操作的资源不存在',
        }
      case 'P2003':
        // 外键约束失败：返回 400
        return {
          status: HttpStatus.BAD_REQUEST,
          code: KBErrorCodes.UNKNOWN_ERROR,
          message: '关联资源不存在或状态不允许操作',
        }
      default:
        // 其他 Prisma 错误统一返回 500，不泄露 meta
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: KBErrorCodes.UNKNOWN_ERROR,
          message: this.isProduction ? '数据库操作失败' : `Prisma ${err.code}`,
        }
    }
  }

  private httpStatusToCode(status: number): string {
    // HTTP 状态码到业务错误码的粗粒度映射
    if (status === HttpStatus.BAD_REQUEST) return KBErrorCodes.INVALID_PARAMETER
    if (status === HttpStatus.UNAUTHORIZED) return KBErrorCodes.AUTH_FAILED
    if (status === HttpStatus.FORBIDDEN) return KBErrorCodes.FORBIDDEN
    if (status === HttpStatus.NOT_FOUND) return KBErrorCodes.RESOURCE_NOT_FOUND
    if (status === HttpStatus.CONFLICT) return KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT
    if (status === HttpStatus.TOO_MANY_REQUESTS) return KBErrorCodes.FORBIDDEN
    return KBErrorCodes.UNKNOWN_ERROR
  }

  private formatError(exception: unknown): string {
    if (exception instanceof Error) {
      return `${exception.name}: ${exception.message}`
    }
    return String(exception)
  }
}
