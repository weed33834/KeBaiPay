/**
 * e2e 测试环境变量预设
 *
 * 作用：在 jest e2e 测试启动前注入完整 mock env，
 * 让需要导入完整 AppModule 的 e2e 测试能通过 validateEnv 校验。
 *
 * 配置：在 jest-e2e.config.js 的 setupFiles 中引入此文件。
 *
 * 注意：
 * - 这些值仅用于测试，不会泄露到生产环境
 * - 测试中应 mock 掉 PrismaService/RedisService 等外部依赖，不会真正连接 DB/Redis
 * - 生产环境的 env 校验逻辑不受影响，此处只是让测试能启动
 */

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_USER_SECRET: 'test-jwt-user-secret-32chars-minimum-length',
  JWT_ADMIN_SECRET: 'test-jwt-admin-secret-32chars-minimum-length',
  JWT_AGENT_SECRET: 'test-jwt-agent-secret-32chars-minimum-length',
  ENCRYPTION_KEY: 'test-encryption-key-32chars-minimum-length',
  ADMIN_DEFAULT_PASSWORD: 'TestAdmin2026',
  SMS_PROVIDER: 'mock',
  RECHARGE_NOTIFY_URL: 'http://localhost:3001/webhooks/recharge/mock',
  CORS_ORIGINS: 'http://localhost:3000',
  // Agent v2.1.0：LLM 走 mock 降级模式，无需真实 LLM API Key
  LLM_PROVIDER: 'mock',
  LLM_API_KEY: '',
  LLM_BASE_URL: 'https://api.deepseek.com',
  LLM_MODEL: 'deepseek-chat',
  LLM_TIMEOUT_MS: '5000',
  LLM_MAX_TOKENS: '500',
  LLM_TEMPERATURE: '0.3',
  JWT_AGENT_EXPIRES_IN: '7d',
  AGENT_MAX_AMOUNT_PER_OP: '50000',
  AGENT_MAX_AMOUNT_PER_DAY: '200000',
  AGENT_CONFIRM_TIMEOUT_SEC: '60',
  VECTRA_INDEX_DIR: './data/vectra-test',
  MCP_STRIPE_ENABLED: 'false',
  MCP_PAYPAL_ENABLED: 'false',
}

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}
