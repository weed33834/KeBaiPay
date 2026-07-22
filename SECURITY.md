# 安全策略 — KeBaiPay

## 报告漏洞

**请勿在公开 Issue 中提交安全漏洞报告。**

如发现安全漏洞，请通过以下方式私下报告：

1. GitHub Security Advisory：[新建安全公告](https://github.com/weed33834/KeBaiPay/security/advisories/new)
2. 邮件：发送至维护者邮箱（见贡献者主页）

**响应时间**：收到报告后 48 小时内确认，7 天内给出初步评估，30 天内发布修复版本。

## 已知安全机制

KeBaiPay 已内置以下安全措施：

### 认证与授权
- 4 种独立 JWT 密钥：用户 / 管理员 / Agent / （商户使用 HMAC-SHA256 签名）
- 支付密码二次校验（资金类操作）
- Agent JWT 独立 `JWT_AGENT_SECRET`，与用户/管理员密钥隔离
- AgentAuthGuard 校验 scope 子集（`authScopes ⊆ agent.scopes`）

### 资金安全
- 复式记账三表联动（AccountLedger + Bill + TransactionOrder）
- Redis 分布式锁防并发（转账/提现/红包领取）
- Prisma 事务保证 ACID
- 幂等键防重放（转账 `idempotencyKey`）
- Human-in-the-Loop：Agent 资金类工具 `requireConfirm=true`，强制用户二次确认
- Agent 限额：`AGENT_MAX_AMOUNT_PER_OP` / `AGENT_MAX_AMOUNT_PER_DAY`

### 敏感数据
- AES-256-GCM 加密身份证、银行卡号
- 身份证 hash 索引（支持模糊查询不泄露原文）
- 手机号/邮箱脱敏输出

### 审计与可追溯
- 链式 hash 审计日志（Agent 操作日志，`pg_advisory_xact_lock` 串行化）
- 管理员操作全记录（AuditLog + LoginLog）
- Request-Logging 中间件记录所有 API 请求

### 风控
- 滑动窗口限流（Redis Lua 脚本）
- 规则引擎 + AI 审计双引擎
- 大额转账/异地登录/频繁操作自动触发风控事件

## 安全配置检查清单（生产部署前）

- [ ] 所有 `*_SECRET` 环境变量已替换为强随机值（≥32 字符）
- [ ] `ENCRYPTION_KEY` 已替换（AES-256-GCM 密钥）
- [ ] `JWT_AGENT_SECRET` 已替换且与 `JWT_USER_SECRET` / `JWT_ADMIN_SECRET` 不同
- [ ] `ADMIN_DEFAULT_PASSWORD` 已修改
- [ ] `MOCK_CHANNEL_SECRET` 已替换或移除 Mock 渠道
- [ ] `LLM_API_KEY` 已配置为生产环境密钥
- [ ] PostgreSQL 已配置 TLS
- [ ] Redis 已配置密码和 TLS
- [ ] CORS_ORIGINS 已限制为生产域名
- [ ] 反向代理已配置 HTTPS（HSTS / TLS 1.2+）
- [ ] 已启用 Rate Limiting（Nginx / Cloudflare 层）
