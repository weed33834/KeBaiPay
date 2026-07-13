/**
 * 环境变量校验（纯 TS 实现，避免引入 joi 依赖）
 *
 * 在 ConfigModule.forRoot({ validate }) 中使用，启动时校验所有必需环境变量。
 * 校验失败抛错，应用拒绝启动，避免运行时才发现配置缺失。
 *
 * 注意：密钥强度、默认值检测由 SecurityValidatorService 负责；
 * 此处只做"存在性 + 格式"校验。
 */

type EnvConfig = Record<string, unknown>

const VALID_NODE_ENV = ['development', 'production', 'test'] as const
const VALID_SMS_PROVIDER = ['aliyun', 'tencent', 'huawei', 'mock'] as const

export function validateEnv(config: EnvConfig): EnvConfig {
  const errors: string[] = []

  // NODE_ENV
  const nodeEnv = (config.NODE_ENV as string) || 'development'
  if (!VALID_NODE_ENV.includes(nodeEnv as any)) {
    errors.push(`NODE_ENV 必须为 ${VALID_NODE_ENV.join('/')} 之一，当前值: ${nodeEnv}`)
  }

  // PORT
  const port = Number(config.PORT)
  if (config.PORT && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    errors.push(`PORT 必须为 1-65535 之间的整数，当前值: ${config.PORT}`)
  }

  // DATABASE_URL
  const databaseUrl = config.DATABASE_URL as string
  if (!databaseUrl) {
    errors.push('DATABASE_URL 未配置')
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL 必须为 postgresql:// 协议')
  }

  // REDIS_URL
  const redisUrl = config.REDIS_URL as string
  if (!redisUrl) {
    errors.push('REDIS_URL 未配置（分布式锁、限流、防重放依赖 Redis）')
  } else if (!/^rediss?:\/\//.test(redisUrl)) {
    errors.push('REDIS_URL 必须为 redis:// 或 rediss:// 协议')
  }

  // 密钥类：存在性校验（强度由 SecurityValidatorService 负责）
  for (const key of ['JWT_USER_SECRET', 'JWT_ADMIN_SECRET', 'ENCRYPTION_KEY']) {
    if (!config[key]) {
      errors.push(`${key} 未配置`)
    }
  }

  // SMS_PROVIDER
  const smsProvider = (config.SMS_PROVIDER as string) || 'mock'
  if (!VALID_SMS_PROVIDER.includes(smsProvider as any)) {
    errors.push(
      `SMS_PROVIDER 必须为 ${VALID_SMS_PROVIDER.join('/')} 之一，当前值: ${smsProvider}`,
    )
  }

  if (errors.length > 0) {
    throw new Error(
      `环境变量校验失败，请修复以下问题后重启：\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    )
  }

  return config
}
