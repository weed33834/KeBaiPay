# 科佰支付开发路线图

> 把 MVP 扩展成能跑的个人钱包 + 商户收款平台。
> 本文档追踪 5 个阶段的落地状态，所有阶段已于 2026-07-13 完成。

## 一、当前状态

**5 个阶段全部已完成，项目进入生产就绪状态。**

技术栈：NestJS 11 + TypeScript 6 + Prisma 7 + PostgreSQL 16/17 + Redis 7 + 前端原生 JS SPA。

## 二、阶段落地状态

### 第一阶段：C 端钱包闭环 ✅

让个人用户能把钱转进来、转出去、发出去、收回来。

**已落地：**

- **提现**：申请 → 冻结余额 → 人工/自动审核 → 到账或退回
- **红包**：一对一红包，24 小时没人领自动退回发红包的人
- **收款码**：个人永久收款码、固定金额码、扫码直接付款
- **转账增强**：单日限额、实名校验、失败退回、大额风控
- **安全中心**：支付密码重置（验证实名信息）、登录风控

**验收通过：**

- 用户能正常发起提现，审核通过后余额扣减
- 红包能在 24 小时后自动退回，双方账单正确
- 扫码付款实时到账并生成账单
- 超过单日限额的转账被拒绝并提示原因

### 第二阶段：商户系统 ✅

让个体户和企业能入驻，用科佰收款。

**已落地：**

- 商户资料提交与后台审核
- 商户独立收款码与收银台
- 按商户配置收款费率、提现费率、日限额
- 商户后台：资料、交易看板、对账导出

**验收通过：**

- 个人/企业商户提交资料后，后台审核通过才开通
- 顾客扫码进入统一收银台付款
- 手续费按商户独立费率扣除
- 对账中心能导出 Excel/CSV

### 第三阶段：开放接入 ✅

让外部网站/App 能接入科佰支付。

**已落地：**

- 统一收银台：15 分钟倒计时、余额支付、结果回调
- 开放平台：APPID/APPSECRET、回调地址配置
- 开放 API：统一下单、订单查询、退款、转账、余额查询
- 统一签名：HMAC-SHA256，防篡改与重放（nonce + Redis）

**验收通过：**

- 第三方传入业务订单号能创建科佰订单并跳转收银台
- 支付成功后按回调地址通知，支持幂等
- 开放接口带签名验证

### 第四阶段：管理后台 + 风控 ✅

平台自己能管得住。

**已落地：**

- 管理员 RBAC 权限与操作日志（审计日志带哈希链防篡改）
- 用户管理：实名审核、冻结/解冻、手动加扣款
- 订单/提现总管理
- 风控规则：单笔限额、单日限额、异常 IP、高频交易
- 风控滑动窗口限流：Redis Lua + ZSET 毫秒级精度
- 审计日志事务一致性：业务写 + 审计日志在同一 `$transaction`

**验收通过：**

- 超级管理员能审核实名、冻结账户、手动调账并留痕
- 提现订单能人工审核，状态正确流转
- 风控规则可配置，命中后拦截或告警

### 第五阶段：财务总账 ✅

钱不能算错。

**已落地：**

- 复式总账：每笔资金变动生成分录，借贷平衡
- 日终对账：Σ 用户余额 = 平台总账余额
- 财务大盘：流水、净收入、手续费、待结算
- 报表导出（CSV）

**验收通过：**

- 每天 2:00 自动对账，差异告警
- 报表能导出
- 财务数据可追溯

## 三、技术约定（所有人必须遵守）

1. **金额单位**：数据库存"分"（Int），接口和前端用"元"。
2. **事务**：所有资金操作必须在 Prisma `$transaction` 内完成。
3. **幂等**：充值、转账、支付接口必须基于 `idempotencyKey` 防重。
4. **签名**：开放 API 用 HMAC-SHA256，参数按 key 字典序拼接。
5. **日志**：资金日志、后台操作日志永久保留，禁止物理删除。
6. **错误码**：统一 `KB001` ~ `KB999`。
7. **代码规范**：DTO 必须加 `class-validator` 装饰器，禁止用 `any`。

## 四、模块依赖

```
用户中心 / 账户中心 / 支付密码
        ↓
转账 / 红包 / 提现 / 收款码
        ↓
商户系统 / 统一收银台 / 开放 API
        ↓
管理后台 / 风控中心
        ↓
财务总账 / 日终对账
```

有依赖的模块先约定接口，再并行开发。

## 五、已落地的技术能力清单

### 基础设施

- 全局异常过滤器 `AllExceptionsFilter` + Prisma 错误码映射
- 进程级异常兜底（unhandledRejection / uncaughtException）
- AsyncLocalStorage + Logger 原型 patch（traceId 自动注入）
- ConfigModule 纯 TS env 校验
- PG 连接池配置（max / statement_timeout / connectionTimeoutMillis）
- k8s readiness probe（故障返回 503）
- Graceful shutdown（app.enableShutdownHooks）

### 安全

- JWT 双密钥（用户/管理员）
- HMAC-SHA256 签名（开放 API）
- RSA2 签名验签（支付宝回调）
- V3 签名 + AES-256-GCM 解密（微信回调）
- bcrypt 密码哈希
- AES-256-GCM 加密（身份证 / 银行卡号）
- helmet 安全头 + 严格 CSP
- 三层限流（default / auth / open-api）
- SecurityValidator 启动强校验
- timingSafeEqual 防时序攻击
- PII 脱敏工具

### 风控

- 6 条内置规则（single_amount / daily_count / daily_amount / frequency / ip_blacklist / ip_frequency）
- Redis Lua + ZSET 滑动窗口限流
- IP 维度 fail-closed
- 风险事件记录与审计

### 可观测性

- Prometheus `/metrics` 端点
- 结构化日志（pino JSON formatter）
- APM（OpenTelemetry trace + Sentry 异常告警）
- RequestLoggingMiddleware（X-Request-Id traceId）

### 测试

- 46 suites / 635+ tests passed
- 16 个 controller 单元测试
- 3 个 e2e 套件（auth / admin-auth / open-api）
- 关键资金 service 均有单测

### 部署

- Docker 多阶段构建 + docker-compose
- 健康检查 + graceful shutdown
- CI/CD pipeline（lint + unit + e2e + build + deploy）
- Nginx 反向代理 + HTTPS 配置示例

## 六、未来路线图（v1.1+）

以下为可选增强，不影响 v1.0 生产部署：

- 消息队列（RabbitMQ / Kafka）削峰 webhook
- 多副本部署 + 蓝绿发布
- OAuth2 第三方登录（微信 / 支付宝）
- 密钥轮换机制
- IP 白名单（管理后台）
- CSRF 防护（若启用 cookie 场景）
- 国际化（i18n）
- 移动端 SDK（iOS / Android）
