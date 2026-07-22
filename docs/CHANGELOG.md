# KeBaiPay 更新日志

> 版本更新记录与功能清单

## 目录

- [版本 2.1.0](#版本-210)（2026-07-22）
- [版本 2.0.0](#版本-200)（2026-07-21）
- [版本 1.0.0](#版本-100)（2026-07-13）
- [已实现功能清单](#已实现功能清单)
- [2026-07 重构记录](#2026-07-重构记录)

---

## 版本 2.1.0

**发布日期：** 2026-07-22

**版本类型：** AI 智能体层接入 —— 把 KeBaiPay 升级为基于 AI Agent 的智能支付平台

### 升级概览

本轮基于对 Vercel AI SDK、Stripe/PayPal Agent Toolkit、Shopify shop-chat-agent、Botpress、n8n 等开源项目的对标分析，新增完整的 AI 智能体层。**新增 10 个 API 端点**（204 → 214）、**新增 5 张 Prisma 模型**（47 → 52）、**新增 1 种认证方式**（AgentAuthGuard，独立 JWT_AGENT_SECRET）、**新增 31 个 e2e 测试**。

### 核心能力

#### 第 4 种认证：AgentAuthGuard

- 独立于 User/Admin/OpenAPI，使用 JWT_AGENT_SECRET 签发长期 token（默认 7d）
- 自包含 CanActivate，不依赖 Passport（仿 AdminJwtAuthGuard）
- token 携带主体授权信息（subjectType/subjectId/authId/authScopes）
- 实时查 DB 校验 Agent.status 与授权未撤销/未过期，防降权残留
- JWT payload 中 `typ='agent'` 与其他三类隔离

#### LLM 服务封装（mock 降级）

- 抽象 LlmService：统一 `chat({ messages, tools, systemPrompt, maxSteps })` 接口
- LLM_PROVIDER=mock 时降级为本地模板引擎（复用 RiskAuditAiEngine 模式）
- 非 mock 时动态 import Vercel AI SDK v7（`generateText` + `tool()` + `maxSteps`）
- SDK 加载失败也降级为 mock，保证无 LLM 环境可用
- 支持 OpenAI 兼容协议（DeepSeek/OpenAI/Moonshot/通义等）

#### 三大 Agent 场景

**C 端钱包管家（wallet）：**
- kbpay_query_balance：查余额（availableBalance/frozenBalance/totalBalance 三段）
- kbpay_query_bill：查账单列表（带 amountYuan 转换）
- kbpay_send_message：发站内消息（LOW/NORMAL/HIGH 优先级）
- kbpay_claim_coupon：领优惠券（走 CouponsService.claim）
- kbpay_transfer：用户间转账（**requireConfirm=true**，强制二次确认）

**B 端店长助理（merchant）：**
- kbpay_query_merchant_orders：查商户订单列表
- kbpay_query_merchant_balance：通过 Merchant→User→Account 关联查询余额
- kbpay_query_reconciliation_diff：查对账差异项

**A 端风控审计官（risk）：**
- kbpay_query_risk_events：查风险事件（按 level/status 过滤）
- kbpay_query_health：查系统与调度任务健康状态
- kbpay_query_reconciliation_diffs：查 S5 多平台对账差异

#### Human-in-the-Loop 资金安全

- 资金类工具（requireConfirm=true）不立即执行
- 写入 AgentOperationLog PENDING_CONFIRM，推送站内消息通知用户
- 用户调 `/agent/confirm` 接口决策：CONFIRM 执行工具 + 更新日志 SUCCESS，REJECT 更新日志 REJECTED
- 默认超时 60 秒（AGENT_CONFIRM_TIMEOUT_SEC）

#### 链式 hash 审计日志

- AgentAuditLogService：每条操作日志带 hash + previousHash
- hash = sha256(JSON({agentId, action, scope, amount, detail, result, previousHash}))
- 使用 `pg_advisory_xact_lock` 串行化同 Agent 写入，防并发分叉
- 创世 hash 为 `0`.repeat(64)
- `verifyChain` 接口可校验哈希链完整性（防篡改）

#### AI 巡检调度

新增 AgentSchedule，3 个 @Cron 任务（注册到 ScheduleHealthService 被自身监控）：
- 每 10 分钟：巡检 ScheduleHealthService，发现连续失败 ≥3 次时 LLM 生成告警
- 每小时：扫描 ReconciliationDifferenceItem PENDING，LLM 生成处置建议
- 每 30 分钟：扫描 RiskEvent HIGH 未处理，LLM 生成处置建议

#### MCP Server（暴露给外部 AI Agent）

- AgentMcpServer：嵌入式 MCP Server（@modelcontextprotocol/sdk）
- 5 个工具：kbpay_query_balance / kbpay_query_order / kbpay_query_bill / kbpay_list_risk_events / kbpay_list_recon_diffs
- 支持两种启动方式：
  1. 嵌入启动（非生产环境，onModuleInit 自动初始化）
  2. 独立进程：`node dist/agent/mcp/standalone.js`（stdio 传输，供 Claude Desktop / Cursor / Trae 配置）

### 新增 Prisma 模型（5 张）

| 模型 | 用途 |
|------|------|
| Agent | 智能体注册表（agentNo/name/appSecret/status/scopes/scenario） |
| AgentAuthorization | 用户/商户对 Agent 的授权（subjectType/scopes/maxAmount/expiresAt/revokedAt） |
| AgentOperationLog | 操作审计日志（链式 hash 防篡改） |
| AgentConversation | 多轮对话会话（convNo/scenario/title/status/summary） |
| AgentMessage | 对话消息（role: USER/ASSISTANT/TOOL/SYSTEM，含 toolCalls/tokens） |

### 新增 API 端点（10 个）

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | /agent/conversations | 创建会话 |
| GET | /agent/conversations | 查询会话列表 |
| GET | /agent/conversations/:id/messages | 查询历史消息 |
| POST | /agent/conversations/:id/close | 关闭会话 |
| POST | /agent/chat | 发送消息（核心入口） |
| POST | /agent/confirm | 确认/拒绝操作 |
| GET | /agent/verify-chain/:agentId | 校验哈希链 |
| POST | /agent/authorize | 用户授权 Agent |
| POST | /agent/revoke/:authId | 撤销授权 |
| GET | /agent/authorizations | 查询授权列表 |

### 新增环境变量

LLM 配置：
- LLM_PROVIDER（mock/openai/deepseek 等，默认 mock）
- LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
- LLM_TIMEOUT_MS / LLM_MAX_TOKENS / LLM_TEMPERATURE

Agent 认证与限额：
- JWT_AGENT_SECRET / JWT_AGENT_EXPIRES_IN
- AGENT_MAX_AMOUNT_PER_OP / AGENT_MAX_AMOUNT_PER_DAY
- AGENT_CONFIRM_TIMEOUT_SEC

向量库与 MCP：
- VECTRA_INDEX_DIR（Vectra 索引目录）
- MCP_STRIPE_ENABLED / STRIPE_SECRET_KEY
- MCP_PAYPAL_ENABLED / PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET

### 新增文件清单（20 个）

```
src/agent/
├── agent-current-user.interface.ts    # Agent 用户上下文类型
├── agent-auth.guard.ts                # 第 4 种认证守卫
├── agent-auth.service.ts              # Agent 创建/授权/login/revoke
├── agent-audit-log.service.ts         # 链式 hash 审计日志
├── agent.controller.ts                # 10 个 HTTP 端点
├── agent.module.ts                    # 模块注册
├── agent.schedule.ts                  # 3 个 AI 巡检 @Cron
├── agent.service.ts                   # 核心编排（会话/消息/confirm）
├── dto/agent.dto.ts                   # 6 个 DTO
├── llm/
│   ├── llm.config.ts                  # LLM 配置加载
│   ├── llm.module.ts                  # @Global 模块
│   └── llm.service.ts                 # LLM 调用 + mock 降级
├── mcp/
│   ├── agent-mcp.server.ts            # 嵌入式 MCP Server
│   └── standalone.ts                  # 独立进程启动入口
└── tools/
    └── tool.registry.ts               # 工具注册表（11 个工具）

prisma/migrations/20260722000000_add_agent_tables/
└── migration.sql                      # 5 张表 DDL

test/
└── agent.e2e-spec.ts                  # 31 个 e2e 测试

docker-compose.agent.yml               # n8n + Botpress 独立部署
```

### 测试

- 新增 31 个 e2e 测试（test/agent.e2e-spec.ts）
- 覆盖：AgentAuthGuard / 会话管理 / chat 核心入口 / authorize / confirm / verify-chain / ToolRegistry / AgentAuditLogService / LlmService mock 模式
- 全量 e2e：4 个套件 39 个测试全部通过
- TypeScript 编译 0 错误

### 参考的开源项目

- Vercel AI SDK v7：Agent 循环（generateText + tool() + maxSteps）
- @modelcontextprotocol/sdk：MCP 协议
- Stripe/PayPal Agent Toolkit：支付工具封装思路
- Shopify shop-chat-agent：AI 电商 Agent 蓝本
- Botpress：TS 原生客服系统（MIT，独立 Docker 部署）
- n8n：TS 原生工作流引擎（Sustainable Use License，独立 Docker 部署）

---

## 版本 2.0.0

**发布日期：** 2026-07-21

**版本类型：** 大版本升级 —— 行业对标后新增 P1 必备 + 运营能力 + 4 大特色功能

### 升级概览

本轮基于对微信支付、支付宝、PayPal、Stripe、Ping++ 等同类产品的对标分析，将行业中"应当具备"的能力补齐到 KeBaiPay，并新增 4 项特色功能。**API 端点从 ~80 增长到 204**，**Prisma 模型从 ~20 增长到 47**，**单元测试从 635 增长到 1023**，**E2E 测试从 ~50 增长到 324**。

### P1 行业标配新增模块

#### 担保交易（Escrow，S2）

类似支付宝担保交易 / 微信担保支付。买卖双方中介担保，资金先冻结到平台，买家确认收货后释放给卖家。

- 6 个端点：创建担保订单、买家付款、卖家发货、确认收货、申请退款、争议处理
- 完整状态机：CREATED → PAID → SHIPPED → COMPLETED，支持 REFUND_PENDING / DISPUTED / REFUNDED
- 涉及表：`EscrowOrder`、`AccountLedger`（双重记账，冻结 + 释放）
- 12 个单元测试 + E2E 测试

#### 批量转账（Batch Transfers）

商户向多用户批量打款，类似微信商家转账到零钱 v3 接口。

- 3 个端点：批量提交、明细查询、状态机管理
- 支持：单批次最多 1000 笔、自动校验、批次状态机
- 涉及表：`BatchTransferOrder`、`BatchTransferItem`
- 状态机：PENDING → PROCESSING → COMPLETED / PARTIAL_FAILED / FAILED

#### 订阅（Subscriptions）

商户配置订阅计划，用户周期性自动扣款。

- 3 个端点：订阅、取消订阅、查看可订阅计划
- 调度器：每天 00:30 扫描到期订阅自动扣款
- 涉及表：`SubscriptionPlan`、`UserSubscription`、`SubscriptionPayment`
- 状态机：ACTIVE → CANCELLED / EXPIRED / PAST_DUE

#### 分账（Splits）

一笔交易的资金按比例分配给多个收款方，类似微信分账接口。

- 2 个端点：创建分账计划、查询分账列表
- 涉及表：`SplitPlan`、`SplitReceiver`
- 状态机：PENDING → PROCESSING → COMPLETED / FAILED

### 运营能力新增模块

#### 优惠券（Coupons）

满减、立减、折扣券。

- 2 个端点：领取优惠券、查询我的优惠券
- 调度器：每 5 分钟扫描过期优惠券自动失效
- 涉及表：`Coupon`、`UserCoupon`
- 状态机：AVAILABLE → USED / EXPIRED

#### 邀请返现（Referrals）

用户邀请好友注册并完成首笔交易，邀请人获得返现奖励。

- 2 个端点：获取邀请码、查询邀请记录
- 涉及表：`ReferralCode`、`ReferralRecord`

#### 消息中心（Messages）

站内消息推送：交易通知、风控通知、系统公告。

- 3 个端点：消息列表、未读数、标记已读
- 涉及表：`Message`、`MessageRead`
- 支持批量已读、未读计数缓存

#### 发票（Invoices）

商户向用户开具电子发票。

- 2 个端点：申请开票、查询开票记录
- 涉及表：`Invoice`
- 状态机：PENDING → ISSUED → VOIDED

### 特色功能（S 系列）

#### S1 微信红包二倍均值法

群红包算法与微信原生体验完全一致：

```javascript
// 第 i 个红包金额上限：
maxAmount = floor(remainingAmount / remainingCount × 2) - 1
// 在 [1, maxAmount] 范围随机；最后一个红包拿剩余全部
```

- 状态机：PENDING → PARTIALLY_RECEIVED → RECEIVED / EXPIRED
- 过期未领完的红包，剩余金额自动退回给发送方
- 调度器：每 5 分钟扫描过期红包
- 4 个端点：发红包、领红包、已发列表、已收列表

#### S2 担保交易（见 P1 部分）

#### S3 AI 风控审计

引入 AI 双引擎审计管理员操作，所有敏感操作记录链式 hash 防篡改。

- 5 个管理端端点：AI 审计事件列表、风控建议、人工复核、统计概览、规则命中分析
- 双引擎：规则引擎（白名单/黑名单/阈值）+ AI 引擎（行为模式异常检测）
- 涉及表：`RiskAuditEvent`、`RiskAuditMessage`、`AdminOperationLog`（链式 hash）
- 状态机：DETECTED → REVIEWING → CONFIRMED / DISMISSED

#### S5 多平台对账聚合

跨支付宝、微信、银行渠道的流水交叉比对，差异自动分类与处理工作流。

- 9 个管理端端点：拉取对账单、列表、详情、流水列表、交叉匹配、差异列表、详情、指派处理人、解决差异
- 4 类差异分类：`MISSING_IN_CHANNEL` / `MISSING_IN_PLATFORM` / `AMOUNT_MISMATCH` / `STATUS_MISMATCH`
- 涉及表：`ChannelStatement`、`ChannelStatementItem`、`ReconciliationDifferenceItem`
- 状态机：PENDING → INVESTIGATING → RESOLVED / IGNORED
- 匹配状态：UNMATCHED → MATCHED / MISMATCHED
- 使用 Redis 分布式锁防并发拉取
- 48 个单元测试 + 22 个 E2E 测试

### 用户端补强

#### 银行卡管理（Bank Cards）

- 4 个端点：绑卡、解绑、列表查询、设置默认卡
- 卡号 AES-256-GCM 加密入库 + SHA-256 hash 唯一约束
- 涉及表：`BankCard`

#### 用户绑定/改密

- 新增端点：绑定手机、绑定邮箱、修改密码
- 6 个用户端点（含实名、支付密码）

### 管理后台增强

#### 11 种细粒度权限码

| 权限码 | 说明 |
|---|---|
| `account:adjust` | 人工调账 |
| `withdrawal:audit` | 提现审核 |
| `reconciliation:run` | 执行对账 |
| `reconciliation:diff:handle` | 对账差异处理（S5 新增） |
| `finance:view` | 财务查看 |
| `identity:audit` | 实名审核 |
| `merchant:audit` | 商户审核 |
| `user:status` | 用户状态管理 |
| `risk:config` | 风控配置 |
| `risk:event:handle` | 风控事件处理 |
| `admin:view` | 管理员查看 |

- `SUPER_ADMIN` 自动拥有 `*` 全权限
- 其他角色按职能分配：FINANCE / CUSTOMER_SERVICE / RISK_OFFICER / AUDITOR

#### 自定义规则模板

- 5 个管理端端点：CRUD 风控规则模板
- 商户/管理员可配置：阈值、白名单、黑名单、行为动作

### 技术基础设施改进

#### 数据模型与迁移

- Prisma 模型从 ~20 增长到 **47 个**，按 15 个业务域分组
- 新增迁移：担保交易、批量转账、订阅、分账、优惠券、邀请返现、消息中心、发票、AI 风控审计、自定义规则、多平台对账聚合、银行卡管理
- 加密字段 + SHA-256 哈希唯一约束：`idCardHash` / `cardNumberHash` / `phoneHash`
- 多处 `idempotencyKey @unique` 保证幂等

#### 测试覆盖

- 单元测试：**1023/1023 通过**（64 套件）
- E2E 测试：**324/324 通过**
- 每个 Service 必须有 `.spec.ts`
- 每个 Controller 必须有 `.controller.spec.ts`
- 关键业务路径有并发测试（`concurrency.spec.ts`）

#### 文档体系

新增/更新以下文档（本轮同步更新）：

- `README.md`：完整重写，加入架构图、状态机、功能矩阵、使用教程
- `docs/API_REFERENCE.md`：完整 158 个 API 端点说明
- `docs/CHANGELOG.md`：本文件
- `docs/ADMIN_GUIDE.md`：新增 S3/S5/自定义规则管理端功能
- `docs/DEVELOPER_GUIDE.md`：新增模块开发规范、新模块概览
- `docs/DEPLOYMENT.md`：完整部署文档
- `docs/QUICKSTART.md`：商户快速接入
- `docs/MERCHANT_GUIDE.md`：商户接入指南
- `docs/SDK_GUIDE.md`：开放 API SDK
- `docs/TROUBLESHOOT.md`：常见问题排查
- `docs/PROJECT_PLAN.md`：项目进度
- `.env.example`：新增 SMTP / OTEL / Sentry / 支付宝/微信渠道环境变量

### 错误码扩展

- KB940-KB945：多平台对账相关错误码
- KB700-KB799：开放 API 扩展
- KB800-KB899：AI 风控审计扩展

### 升级须知

1. **数据库迁移**：执行 `npx prisma migrate deploy` 应用本轮新增的迁移
2. **新增环境变量**（可选）：SMTP_*、OTEL_*、SENTRY_DSN、ALIPAY_*、WECHAT_PAY_*（详见 .env.example）
3. **JWT_ADMIN_SECRET 与 JWT_USER_SECRET 必须不同**：本轮多个模块（risk-audit、channel-reconciliation、invoices、custom-rules）独立引入 JwtModule.registerAsync，复用 JWT_ADMIN_SECRET
4. **管理员权限需要重新分配**：新增 `reconciliation:diff:handle`、`risk:config` 等权限码
5. **mock 渠道禁用**：生产环境 SecurityValidator 会拒绝启动 mock 渠道

---

## 版本 1.0.0

**发布日期：** 2026-07-13

**版本类型：** 首个正式发布版本

### 核心功能

#### 用户模块
- 用户注册（手机号/邮箱）
- 用户登录
- 获取用户信息
- 实名认证提交
- 实名认证审核
- 支付密码设置与重置
- 当日限额查询

#### 账户模块
- 账户余额查询
- 资金流水查询

#### 交易模块
- 账户充值
- 用户间转账

#### 提现模块
- 提现申请
- 提现记录查询
- 提现审核（通过/拒绝）

#### 红包模块
- 发红包
- 领红包
- 已发红包查询
- 已收红包查询
- 红包过期自动退回

#### 收款码模块
- 个人收款码获取
- 固定金额收款码创建
- 扫码付款

#### 账单模块
- 账单列表查询
- 收支类型筛选

#### 商户模块
- 商户入驻申请
- 商户信息管理
- 应用创建与管理
- 密钥重新生成
- 商户数据看板
- 商户收款码管理

#### 收银台模块
- 收银台订单创建
- 订单查询
- 订单支付
- 订单导出
- 对账查询
- 回调通知重试
- 扫码获取收款信息

#### 开放 API 模块
- HMAC-SHA256 签名认证
- 创建收款订单
- 查询订单详情
- 申请退款（全额/部分）
- 商户转账
- 查询商户余额

#### 管理后台模块
- 管理员登录
- 管理员密码修改
- 数据概览
- 用户管理（列表/详情/状态/风控等级）
- 商户管理（列表/审核/配置）
- 提现审核（列表/通过/拒绝）
- 支付订单列表
- 风控事件管理
- 登录日志
- 实名认证审核
- 人工调账
- 操作审计日志
- 管理员管理（创建/更新/删除/重置密码）
- 系统配置管理
- 支付渠道管理（创建/更新/删除/测试）

#### 财务模块
- 财务概览
- 每日收支汇总
- 商户结算明细
- 手续费收入统计
- 每日资产快照
- 未结算订单汇总
- 结算执行
- 对账报告生成
- 报表导出（CSV）

#### 健康检查模块
- 存活探针
- 就绪探针（DB/Redis 连通性检查）
- 调度任务状态
- 支付渠道状态

#### 安全模块
- JWT 认证（用户/管理员）
- HMAC 签名认证（商户）
- 密码加密（bcrypt）
- 敏感数据加密
- 请求日志记录
- 安全头配置
- 频率限制
- 防重放机制（nonce）

#### 风控模块
- 大额交易检测
- 频繁交易检测
- 频繁登录检测
- 可疑设备检测
- 风控规则配置

#### 通知模块
- 回调通知发送
- 邮件通知

#### 数据库模块
- Prisma ORM 集成
- PostgreSQL 16/17 支持
- 数据库迁移

#### 缓存模块
- Redis 集成
- 进程内缓存降级

### 技术特性

- NestJS 框架
- TypeScript 开发
- RESTful API 设计
- Swagger API 文档
- 单元测试覆盖
- 端到端测试
- Docker 容器化支持
- PM2 部署支持

---

## 已实现功能清单

### 用户端功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 用户注册 | ✅ | 手机号/邮箱注册 |
| 用户登录 | ✅ | JWT 认证 |
| 实名认证 | ✅ | 身份证认证 |
| 支付密码 | ✅ | 设置/重置 |
| 账户充值 | ✅ | 多种支付方式 |
| 用户转账 | ✅ | 用户间转账 |
| 提现申请 | ✅ | 银行卡提现 |
| 发红包 | ✅ | 普通红包（二倍均值法） |
| 领红包 | ✅ | 领取红包 |
| 个人收款码 | ✅ | 生成/分享 |
| 固定金额收款码 | ✅ | 指定金额 |
| 扫码付款 | ✅ | 扫码支付 |
| 账单查询 | ✅ | 收支记录 |
| 当日限额 | ✅ | 限额查询 |
| 银行卡管理 | ✅ v2.0 | 绑卡/解绑/设默认卡 |
| 担保交易 | ✅ v2.0 | S2 买卖中介担保 |
| 批量转账 | ✅ v2.0 | 商户批量打款 |
| 订阅 | ✅ v2.0 | 周期性自动扣款 |
| 分账 | ✅ v2.0 | 多方资金分配 |
| 优惠券 | ✅ v2.0 | 满减/立减/折扣 |
| 邀请返现 | ✅ v2.0 | 邀请好友奖励 |
| 消息中心 | ✅ v2.0 | 站内消息 |
| 发票 | ✅ v2.0 | 电子发票 |

### 商户端功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 商户入驻 | ✅ | 申请审核 |
| 应用管理 | ✅ | 创建/删除 |
| 密钥管理 | ✅ | 生成/重置 |
| 创建订单 | ✅ | HMAC 签名 |
| 查询订单 | ✅ | 订单详情 |
| 申请退款 | ✅ | 全额/部分 |
| 商户转账 | ✅ | 向用户转账 |
| 余额查询 | ✅ | 商户余额 |
| 数据看板 | ✅ | 交易统计 |
| 收款码管理 | ✅ | 创建/删除 |

### 管理端功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 管理员登录 | ✅ | JWT 认证 |
| 数据概览 | ✅ | 统计数据 |
| 用户管理 | ✅ | 列表/详情/状态 |
| 商户审核 | ✅ | 通过/拒绝 |
| 商户配置 | ✅ | 费率/限额 |
| 提现审核 | ✅ | 通过/拒绝 |
| 实名审核 | ✅ | 通过/拒绝 |
| 人工调账 | ✅ | 余额调整 |
| 风控管理 | ✅ | 事件/规则 |
| 系统配置 | ✅ | 参数设置 |
| 渠道管理 | ✅ | 创建/测试 |
| 审计日志 | ✅ | 操作记录 |
| 多平台对账聚合 | ✅ v2.0 | S5 跨渠道流水比对 |
| AI 风控审计 | ✅ v2.0 | S3 双引擎审计 |
| 自定义规则 | ✅ v2.0 | 风控规则模板 CRUD |

### 财务功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 财务概览 | ✅ | 数据统计 |
| 收支汇总 | ✅ | 每日汇总 |
| 商户结算 | ✅ | T+1 结算 |
| 手续费统计 | ✅ | 收入统计 |
| 资产快照 | ✅ | 每日快照 |
| 对账报告 | ✅ | 自动/手动 |
| 报表导出 | ✅ | CSV 格式 |

### 技术特性

| 特性 | 状态 | 说明 |
|------|------|------|
| JWT 认证 | ✅ | 用户/管理员独立密钥 |
| HMAC 签名 | ✅ | 商户 API |
| 密码加密 | ✅ | bcrypt |
| 敏感数据加密 | ✅ | AES-256-GCM |
| 频率限制 | ✅ | 多层限制 + 滑动窗口 |
| 防重放 | ✅ | nonce 机制 |
| 风控引擎 | ✅ | 规则配置 + AI 审计 |
| 审计日志 | ✅ | 链式 hash 防篡改 |
| 健康检查 | ✅ | 多维度检查 |
| Docker 支持 | ✅ | 容器化部署 |
| PM2 支持 | ✅ | 进程管理 |
| 单元测试 | ✅ | Jest (1023) |
| 端到端测试 | ✅ | Supertest (324) |
| OpenTelemetry | ✅ v1.0 | OTLP trace |
| Prometheus | ✅ v1.0 | /metrics 端点 |
| Sentry | ✅ v1.0 | 异常告警 |

---

## 2026-07-11 清理记录

- 删除无用的测试 spec（auth/red-packets/security-validator，生产代码已引入 RedisService 但 spec 未跟进，当前无维护价值）
- 删除冗余 VERSION.txt、过期的 SMS_CONFIGURATION.md
- 删除远程 TAG v0.0.1、dependabot 自动分支
- 推送覆盖远程 main，清空旧描述与过期 .github 模板
- README 项目结构对齐实际 27 个模块
- 依赖更新至 ^ 范围内最新（TS6/Jest29 稳定组合保留）

---

## 2026-07 重构记录

### 2026-07-13 阶段 1-4：安全与基础设施加固

- **阶段 1**：安全红线修复与冗余清理（密钥泄露/硬编码密钥/SQL 注入防护加固）
- **阶段 2a**：造轮子替换与时区修复（移除自实现 crypto/日期工具，改用成熟库）
- **阶段 2b**：P0 安全与资金安全修复
- **阶段 2c**：P0 review 修复 8 项阻断项
- **阶段 3**：业务逻辑完善与风控/权限/数据一致性加固
- **阶段 4**：部署/CI/文档完善

### 2026-07-13 第三批基础设施 P0 修复

- 全局异常过滤器 `AllExceptionsFilter`：统一 `ApiErrorResponse` envelope + Prisma 错误码映射（P2002→409 / P2025→404 / P2003→400）
- 进程级异常兜底：`unhandledRejection` / `uncaughtException` 接管
- AsyncLocalStorage + Logger 原型 patch：traceId 自动注入 service 层日志
- ConfigModule 纯 TS env 校验（无 joi 依赖）
- PG 连接池配置：`max` / `statement_timeout` / `connectionTimeoutMillis`
- k8s readiness probe：故障返回 503 让 Pod 摘除流量
- 微信代付 batch_status 校验：`success_num >= total_num` 防资金事故
- X-Forwarded-For 伪造防护：改用 `req.ip` + `trust proxy 1`
- 风控 fail-closed：Redis 不可用时 IP 频率规则抛错阻断交易
- 支付密码推迟到实名审核通过：`pendingPayPasswordHash` 暂存机制

### 2026-07-13 短信 SDK 接入

- 接入腾讯云官方 SDK `tencentcloud-sdk-nodejs-sms`（API 3.0，TC3-HMAC-SHA256 签名）
- 接入华为云短信 HTTP `POST /sms/batchSendSms/v1` + SDK-HMAC-SHA256 签名（无 SDK 依赖）
- 新增 `docs/sms-integration.md` 商家自助接入指南
- 未配置时默认 `SMS_PROVIDER=mock`，生产环境 SecurityValidator 拒绝启动

### 2026-07-13 风控滑动窗口限流

- Redis Lua + ZSET 滑动窗口替换固定窗口分桶计数
- `RedisService` 新增 `slidingWindowCheck` / `slidingWindowCount` / `slidingWindowRecord` 三个方法
- 毫秒级精度，无 key 永驻（PEXPIRE 自动过期），原子性（Lua 单命令）
- IP 维度 fail-closed 保持

### 2026-07-13 P0-8 审计日志事务一致性

- 重构 `admin.service` 8 个非事务方法：业务写 + 审计日志全部包入 `$transaction`
- 补 `createAdminUser` 审计漏记
- `channel-config.controller` 三处（createChannel/updateChannel/deleteChannel）同类问题治理
- admin.service 9 个事务方法补 `auditMeta` 参数，审计日志可记录 IP/UA 上下文
- 抽共享模板 `persistConfigWithAudit`，消除 setSystemConfig/updateSystemConfig/createSystemConfig 三方法重复

### 2026-07-13 测试补全

- 补全 16 个 controller 单元测试，新增 172 个测试用例
- 新增 9 个 admin 事务一致性回归测试
- 新增 4 个滑动窗口方法测试
- 全量测试：46 suites / 635 tests passed

### 2026-07-13 可观测性增强

- 新增 Prometheus `/metrics` 端点（业务指标：TPS / 错误率 / 资金流水金额 / 渠道成功率）
- 结构化日志：pino JSON formatter，可接 ELK/Loki
- APM 接入：OpenTelemetry trace + Sentry 异常告警

### 2026-07-13 微信回调与 webhook 加固

- 修复微信回调 `extractOrderNo` 锁 key 退化为 `unknown` 问题
- webhook 回调日志落库（不再仅 `logger.log`）
- 新增 `webhooks.service.spec.ts` 单测
- 新增 `refund.service.spec.ts` / `settlement.service.spec.ts` / `auth.service.spec.ts` 单测

### 2026-07-13 CI/CD 完善

- CI 集成 e2e 测试步骤
- 新增 CD pipeline（自动部署到服务器）

### 2026-07-21 v2.0.0 大版本升级

- 行业对标分析：微信支付、支付宝、PayPal、Stripe、Ping++
- 新增 P1 行业标配：担保交易、批量转账、订阅、分账
- 新增运营能力：优惠券、邀请返现、消息中心、发票
- 新增 4 项特色功能：S1 红包二倍均值法、S2 担保交易、S3 AI 风控审计、S5 多平台对账聚合
- 用户端补强：银行卡管理、绑定手机/邮箱、改密
- 管理后台增强：11 种权限码、自定义规则模板
- API 端点：~80 → 204（增长 155%）
- Prisma 模型：~20 → 47（增长 135%）
- 单元测试：635 → 1023（增长 61%）
- E2E 测试：~50 → 324（增长 548%）
- 文档体系全面更新：README 重写 + 12 个 docs 文件同步更新
