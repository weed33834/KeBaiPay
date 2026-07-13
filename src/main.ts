import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '..', '.env') })
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Logger, ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import compression from 'compression'
import { AppModule } from './app.module'
import { SecurityValidatorService } from './security/security-validator.service'
import { ResponseTransformInterceptor } from './common/response-transform.interceptor'
import { AllExceptionsFilter } from './common/all-exceptions.filter'
import { patchLoggerWithTraceId } from './common/trace-context'

// 在 NestFactory.create 之前 patch Logger 原型，
// 使所有 service 层 Logger 实例的 log/warn/error 自动注入 [traceId] 前缀
patchLoggerWithTraceId()

// 进程级异常兜底：Nest 容器生命周期之外的异常必须接管，
// 否则 Promise rejection 会让进程进入未定义状态，资金类操作可能数据错乱。
// 策略：记录完整 stack 后退出，由容器编排（k8s/docker）拉起新实例。
const bootstrapLogger = new Logger('Bootstrap')
process.on('unhandledRejection', (reason: unknown) => {
  bootstrapLogger.error(
    `Unhandled promise rejection: ${reason instanceof Error ? reason.message : reason}`,
    reason instanceof Error ? reason.stack : undefined,
  )
  // 不立即 process.exit，给日志 flush 时间；下一个事件循环再退
  setImmediate(() => process.exit(1))
})
process.on('uncaughtException', (err: Error) => {
  bootstrapLogger.error(
    `Uncaught exception: ${err.message}`,
    err.stack,
  )
  // uncaughtException 后进程状态不可预测，必须退出
  setImmediate(() => process.exit(1))
})

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })

  // 优雅停机：收到 SIGTERM/SIGINT 时先关闭连接再退出，保证进行中的资金事务完成
  app.enableShutdownHooks()

  // 信任反向代理，正确获取客户端真实 IP
  app.set('trust proxy', 1)

  // 显式限制请求体大小，防止超大请求导致 DoS
  app.useBodyParser('json', { limit: '1mb' })
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true })

  // 响应压缩：减少传输体积，提升性能
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false
      }
      return compression.filter(req, res)
    },
    threshold: 1024,
  }))

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }))

  // 生产环境安全校验：使用默认密钥时拒绝启动
  const securityValidator = app.get(SecurityValidatorService)
  securityValidator.validate()

  // 输入消毒改为输出时按上下文处理：邮件 HTML 转义在 notifications.service.ts 内做，
  // CSV 公式注入防护在 csv.ts 内做，SQL 用 Prisma 参数化查询。
  // 全局 HTML 转义会破坏 URL（callbackUrl 含 & 被转义为 &amp; 导致支付回调失败）、
  // 密码哈希（转义后字符串与原始密码哈希不一致）、JSON 字段，违反 OWASP"输出消毒"原则。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  )

  app.useGlobalInterceptors(new ResponseTransformInterceptor())

  // 全局异常过滤器：统一所有未捕获异常的响应格式，
  // Prisma 错误转换为业务错误码，未知错误剥离 stack 避免信息泄露
  app.useGlobalFilters(new AllExceptionsFilter())

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:8080']
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-Id',
      'X-App-Id',
      'X-Timestamp',
      'X-Nonce',
      'X-Signature',
      'Accept',
      'Accept-Language',
      'Cache-Control',
    ],
    credentials: true,
    maxAge: 86400,
  })

  const isProduction = process.env.NODE_ENV === 'production'

  // Swagger API 文档：生产环境不挂载，避免接口结构与参数暴露
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('科佰支付 KeBaiPay API')
      .setDescription(
        '个人钱包 + 商户收款平台接口文档\n\n' +
        '## 认证方式\n' +
        '- **用户接口**：使用 JWT Bearer Token 认证\n' +
        '- **商户开放 API**：使用 HMAC-SHA256 签名认证\n' +
        '- **管理后台**：使用管理员 JWT Token 认证\n\n' +
        '## 错误码规范\n' +
        '所有错误返回统一格式：`{ "statusCode": number, "message": "KBxxx 错误描述" }`\n\n' +
        '## 金额说明\n' +
        '数据库存储单位为「分」，接口传输单位为「元」'
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '用户/管理员 JWT Token',
        },
        'user-auth',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-App-Id',
          in: 'header',
          description: '商户应用 App ID',
        },
        'app-id',
      )
      .addTag('认证', '用户注册、登录')
      .addTag('用户', '用户信息、实名认证')
      .addTag('账户', '账户余额、资金流水')
      .addTag('交易', '充值')
      .addTag('转账', '用户间转账')
      .addTag('提现', '提现申请')
      .addTag('红包', '红包创建与领取')
      .addTag('收款码', '个人/固定收款码')
      .addTag('账单', '交易账单查询')
      .addTag('商户', '商户入驻、应用管理')
      .addTag('收银台', '统一收银台订单')
      .addTag('开放 API', '商户支付接口（HMAC 签名认证）')
      .addTag('健康检查', '系统探针')
      .addTag('管理后台', '管理员操作')
      .addTag('财务', '财务统计与对账')
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        tagsSorter: 'alpha',
        operationsSorter: 'method',
      },
    })
  }

  const port = process.env.PORT || 3000
  await app.listen(port)
  const logger = new Logger('Bootstrap')
  logger.log(`KeBaiPay MVP running on http://localhost:${port}`)
  if (!isProduction) {
    logger.log(`Swagger 文档: http://localhost:${port}/api/docs`)
  }
}
bootstrap()
