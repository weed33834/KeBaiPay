# KeBaiPay 开发者指南

> 科佰支付 - 个人钱包 + 商户收款平台

## 目录

- [快速开始](#快速开始)
- [项目架构](#项目架构)
- [v2.0.0 新增模块概览](#v200-新增模块概览)
- [模块开发规范](#模块开发规范)
- [数据库与复式记账](#数据库与复式记账)
- [权限系统详解](#权限系统详解)
- [可观测性](#可观测性)
- [认证方式](#认证方式)
  - [用户 JWT 认证](#用户-jwt-认证)
  - [管理员认证](#管理员认证)
  - [商户 HMAC 签名认证](#商户-hmac-签名认证)
- [API 端点索引](#api-端点索引)
- [错误码规范](#错误码规范)
- [频率限制](#频率限制)
- [测试规范](#测试规范)
- [调度任务（@nestjs/schedule）](#调度任务nestjs-schedule)
- [常见问题](#常见问题)

---

## 快速开始

### 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 20 | NestJS 11 + TypeScript 6 要求 |
| PostgreSQL | >= 16 | 不再支持 SQLite |
| Redis | >= 7 | 生产环境必填，资金操作的并发安全靠它 |

### 安装与启动

```bash
# 1. 克隆项目（任选其一，国内推荐 gitcode 镜像）
# GitHub（国际）：
git clone https://github.com/weed33834/KeBaiPay.git
# gitcode（国内）：
git clone https://gitcode.com/badhope/KeBaiPay.git
cd KeBaiPay

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，至少修改 JWT_USER_SECRET、JWT_ADMIN_SECRET 和 ENCRYPTION_KEY

# 4. 初始化数据库
npm run db:push

# 5. 启动开发服务
npm run start:dev
```

服务启动后：
- API 服务：`http://localhost:3000`
- Swagger 文档：`http://localhost:3000/api/docs`（仅开发环境）

### 常用命令

```bash
npm run build          # 构建生产版本
npm run start:prod     # 生产模式启动
npm run test           # 单元测试
npm run test:e2e       # 端到端测试
npm run db:studio      # 打开 Prisma Studio 可视化数据库
npm run lint           # TypeScript 类型检查
npm run migrate:dev    # 创建数据库迁移
npm run migrate:deploy # 部署数据库迁移
```

---

## 项目架构

```
src/
├── auth/                       # 用户认证（注册、登录、JWT）
├── users/                      # 用户管理（实名认证、支付密码）
├── accounts/                   # 账户余额、资金流水
├── transactions/               # 充值交易
├── transfers/                  # 用户间转账
├── withdrawals/                # 提现申请与审核
├── red-packets/                # 红包功能
├── qr-codes/                   # 个人收款码
├── bills/                      # 账单查询
├── bank-cards/                 # 银行卡管理（v2.0：AES-256-GCM 加密 + SHA-256 hash）
├── escrow/                     # 担保交易 S2（资金冻结、超时放款、争议退款）
├── batch-transfers/            # 批量转账（原子提交、逐笔处理）
├── subscriptions/              # 订阅 / 周期扣款（计划、订阅、自动扣款调度）
├── splits/                     # 分账（按比例/固定金额分给多接收方）
├── coupons/                    # 优惠券（FIXED/PERCENT、领取、使用、过期调度）
├── referrals/                  # 邀请返现（邀请码、绑定关系、奖励触发）
├── messages/                   # 消息中心（广播 + 定向，已读跟踪）
├── invoices/                   # 发票（普通/专用，商户申请、管理员开具）
├── channel-reconciliation/     # 多平台对账聚合 S5（渠道对账单 + 差异处理工作流）
├── risk-audit/                 # AI 风控审计 S3（会话式多轮对话）
├── custom-rules/               # 自定义风控规则模板（DSL 编排、动作 BLOCK/WARN/REVIEW）
├── metrics/                    # Prometheus /metrics（HTTP 计数器、延迟直方图）
├── merchants/                  # 商户管理（入驻、应用、收款码）
├── cashier/                    # 收银台（创建订单、支付、对账）
├── open-api/                   # 商户开放 API（HMAC 签名认证）
├── admin/                      # 管理后台（用户/商户/提现审核、风控、系统配置）
├── finance/                    # 财务模块（结算、对账、快照、报表）
├── webhooks/                   # 回调通知
├── payment-channels/           # 支付渠道（支付宝、微信）
├── risk/                       # 风控引擎
├── security/                   # 安全模块
├── audit/                      # 审计日志（链式 hash 防篡改）
├── crypto/                     # 敏感字段加解密（AES-256-GCM）
├── sms/                        # 短信服务
├── notifications/              # 通知服务（结算通知）
├── health/                     # 健康检查
├── redis/                      # Redis 服务（含 withLock 分布式锁）
├── prisma/                     # 数据库 ORM
├── common/                     # 公共工具（错误码、枚举、分页、加解密、JsonLogger、trace-context）
├── tracing.ts                  # OpenTelemetry SDK 接入（OTLP HTTP 导出）
└── app.module.ts               # 根模块
```

---

## v2.0.0 新增模块概览

v2.0.0 在原有用户钱包 + 商户收款能力之上扩展了 12 个业务模块。下表汇总各模块的路由前缀、认证方式、关键能力与涉及的数据库表，便于快速定位代码与数据库结构。

| 模块 | 路由前缀 | 认证方式 | 关键能力 | 涉及表 |
|------|----------|----------|----------|--------|
| bank-cards | `/bank-cards` | 用户 JWT | 绑卡 / 解绑 / 设置默认卡，卡号 AES-256-GCM 加密 + SHA-256 hash 唯一约束 | `bank_cards` |
| escrow | `/escrow` | 用户 JWT | 担保交易 S2：买家付款资金冻结、卖家发货、买家确认收货放款、超时自动放款/取消、退款争议 | `escrow_orders`、`accounts`（frozenBalance） |
| batch-transfers | `/batch-transfers` | 用户 JWT | 批量转账：一次性向多收款方转账，原子校验后逐笔处理，支持取消 | `batch_transfers`、`batch_transfer_items`、`transaction_orders` |
| subscriptions | `/subscriptions` | 用户 JWT | 订阅 / 周期扣款：商家创建计划，用户订阅，支持试用期、暂停/恢复/取消，调度自动扣款 | `subscription_plans`、`subscriptions`、`subscription_charges` |
| splits | `/splits` | 用户 JWT | 分账：把一笔已支付订单按比例/固定金额分给多个接收方 | `split_orders`、`split_items`、`transaction_orders` |
| coupons | `/coupons` | 用户 JWT | 优惠券：FIXED/PERCENT 两种类型，商家创建、用户领取/使用，调度自动过期 | `coupons`、`user_coupons` |
| referrals | `/referrals` | 用户 JWT | 邀请返现：一人一码、被邀请人绑定、首笔交易触发奖励 | `referral_codes`、`referrals` |
| messages | `/messages` | 用户 JWT | 消息中心：广播（userId=null）+ 定向，多通道（IN_APP/SMS/EMAIL），已读跟踪 | `messages`、`message_reads` |
| invoices | `/invoices`、`/admin/invoices` | 用户 JWT / Admin JWT | 商户发票：普通/专用，商户申请、管理员开具/作废 | `invoices` |
| channel-reconciliation | `/admin/channel-reconciliation` | Admin JWT + PermissionsGuard | 多平台对账聚合 S5：渠道对账单拉取、交叉匹配、差异处理工作流（指派 → 解决） | `channel_statements`、`channel_statement_items`、`reconciliation_difference_items` |
| risk-audit | `/risk-audit`、`/admin/risk-audit` | 用户 JWT / Admin JWT | AI 风控审计 S3：用户与 AI 助手多轮对话，识别意图、命中规则、生成摘要 | `risk_audit_sessions`、`risk_audit_messages` |
| custom-rules | `/admin/risk-rules/custom`、`/risk-rules/custom` | Admin JWT + PermissionsGuard / 用户 JWT | 自定义风控规则模板：DSL 编排多条件（AND/OR），动作 BLOCK/WARN/REVIEW，支持启用/禁用/测试 | `custom_risk_rules` |

> 各模块的完整端点列表（请求体、响应、错误码）见 [API_REFERENCE.md](./API_REFERENCE.md)。

---

## 模块开发规范

### 目录结构约定

每个业务模块统一遵循 NestJS 推荐结构，文件命名使用 kebab-case + 后缀：

```
src/<module>/
├── dto/                          # 请求 DTO，使用 class-validator 装饰器
│   └── create-<entity>.dto.ts
├── <module>.controller.ts        # 路由层，仅做参数校验与转发
├── <module>.controller.spec.ts   # 控制器测试（必备）
├── <module>.service.ts           # 业务逻辑层
├── <module>.service.spec.ts      # Service 单元测试（必备）
├── <module>.module.ts            # 模块声明（providers / imports / exports）
├── <module>.schedule.ts          # 调度任务（如有）
└── concurrency.spec.ts           # 并发测试（仅资金类模块，如 transfers / withdrawals）
```

### 测试要求

| 文件 | 必备场景 | 说明 |
|------|----------|------|
| `<module>.service.spec.ts` | 所有 Service | 覆盖核心分支：成功路径、参数校验、错误码、状态机迁移 |
| `<module>.controller.spec.ts` | 所有 Controller | 验证路由、Guard 装配、响应格式 |
| `concurrency.spec.ts` | 资金类模块（transfers / withdrawals / escrow / batch-transfers / splits / subscriptions） | 模拟并发请求，验证 `withLock` + `$transaction` 防止重复扣款、超扣 |

### DTO 校验

所有 DTO 必须使用 `class-validator` 装饰器声明字段约束，并在 `main.ts` 全局开启 `ValidationPipe`：

```typescript
import { IsString, IsInt, Min, Max, IsEnum, IsOptional } from 'class-validator'

export class CreateBatchTransferDto {
  @IsString()
  remark?: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  items: { toUserId: string; amount: number }[]

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
```

### 资金操作并发安全

任何修改账户余额、订单状态的资金操作必须同时满足：

1. 包入 Prisma `$transaction` 保证多表原子性
2. 通过 `RedisService.withLock(key, ttl, fn)` 加分布式锁，防止并发请求重复扣款
3. 写入 `AccountLedger` 记录余额变更前/后值，便于审计追溯

```typescript
await this.redis.withLock(`transfer:${fromUserId}`, 30, async () => {
  await this.prisma.$transaction(async (tx) => {
    // 1. 校验余额
    // 2. 扣减 fromUser 余额，增加 toUser 余额
    // 3. 写 AccountLedger（balanceBefore / balanceAfter 必填）
    // 4. 创建 TransactionOrder
    // 5. 创建 Bill（用户视角账单）
  })
})
```

### 加密字段约定

身份证号、银行卡号、预留手机号等敏感字段必须使用 `CryptoService`（AES-256-GCM）加密入库，密文格式 `base64(iv:ciphertext:authTag)`，每次加密密文不同。同时存 SHA-256 明文哈希用于唯一约束：

| 字段 | 加密列 | Hash 列（@unique） | 模型 |
|------|--------|---------------------|------|
| 身份证号 | `IdentityVerification.idCard` | `IdentityVerification.idCardHash` | 防止同一身份证被多用户提交 |
| 银行卡号 | `BankCard.cardNumber` | `BankCard.cardNumberHash` | 同一用户下卡号唯一 |
| 预留手机号 | `BankCard.phone` | `BankCard.phoneHash` | 可选 |

> 不能直接对加密列加 `@unique`：AES-256-GCM 每次密文不同，唯一约束会失效。

### 审计与防篡改

| 操作类型 | 记录位置 | 说明 |
|----------|----------|------|
| 普通业务审计 | `AuditLog` / 业务日志表 | 资金流向、状态变更 |
| 管理员敏感操作 | `AdminOperationLog`（链式 hash） | 调账、提现审核、用户状态变更、风控等级变更、实名审核等 |

`AdminOperationLog` 通过 `hash` + `previousHash` 形成哈希链，任何对历史日志的篡改都会导致后续 `previousHash` 不匹配，由 `AuditSchedule` 每天凌晨 3 点全量校验。详见 [数据库与复式记账](#数据库与复式记账)。

---

## 数据库与复式记账

数据库使用 PostgreSQL 16+，ORM 为 Prisma。Schema 文件位于 `prisma/schema.prisma`。

### 复式记账三表联动

KeBaiPay 的资金流水通过三张表联动实现复式记账，确保每笔资金变动可双向追溯：

```mermaid
flowchart LR
    A[TransactionOrder<br/>交易订单<br/>type/status/amount] -->|扣款/入账| B[AccountLedger<br/>账户流水<br/>balanceBefore/After]
    A -->|用户视角| C[Bill<br/>用户账单<br/>direction/counterparty]
    B -->|关联账户| D[Account<br/>availableBalance<br/>frozenBalance<br/>totalBalance]
```

| 表 | 角色 | 关键字段 |
|----|------|----------|
| `TransactionOrder` | 交易主订单，承载 type / status / amount / fee / channel / idempotencyKey | `orderNo` (@unique)、`fromUserId`、`toUserId`、`relatedOrderNo` |
| `AccountLedger` | 账户维度的资金流水，每笔变动一条，记录余额变更前后值 | `accountId`、`transactionId`、`balanceBefore`、`balanceAfter`、`direction` |
| `Bill` | 用户视角的账单（收入/支出/手续费），用于用户端展示 | `userId`、`transactionId`、`direction`、`amount`、`counterparty` |
| `Account` | 账户当前余额快照 | `availableBalance`、`frozenBalance`、`totalBalance` |

资金操作的写入顺序：`TransactionOrder` → `Account`（更新余额）→ `AccountLedger`（写流水）→ `Bill`（写用户账单），全部在同一 `$transaction` 内完成。

### 加密字段约定

敏感字段采用「加密列 + 哈希列」双列设计，加密列存密文（每次不同），哈希列存 SHA-256 明文哈希（用于唯一约束与查询）：

| 字段 | 加密列 | 哈希列（@unique） | 用途 |
|------|--------|---------------------|------|
| 身份证号 | `IdentityVerification.idCard` | `IdentityVerification.idCardHash` | 防止同一身份证被多用户提交 |
| 银行卡号 | `BankCard.cardNumber` | `BankCard.cardNumberHash` | 同一用户下卡号唯一 |
| 银行卡预留手机号 | `BankCard.phone` | `BankCard.phoneHash` | 可选，便于查询 |

加密算法：AES-256-GCM，密钥从 `ENCRYPTION_KEY` 通过 `scryptSync` 派生，存储格式 `base64(iv:ciphertext:authTag)`。详见 `src/crypto/crypto.service.ts`。

### 链式 hash 防篡改

`AdminOperationLog` 通过哈希链实现防篡改审计：

| 字段 | 说明 |
|------|------|
| `hash` | 当前日志的 SHA-256 哈希，内容包含 `adminId / action / target / detail / ip / userAgent / previousHash` |
| `previousHash` | 上一条日志的 `hash`，链条首条指向 `0`.repeat(64) 创世哈希 |
| `seq` | 单调递增序列号，解决毫秒精度 `createdAt` 并发写入顺序不确定问题 |

写入流程（`AuditLogService.log`）：
1. 通过 PostgreSQL 事务级咨询锁 `pg_advisory_xact_lock(8831, 1)` 串行化，防止并发写入分叉
2. 读取上一条日志的 `hash` 作为 `previousHash`
3. 计算当前 `hash = SHA256(JSON.stringify({ ...content, previousHash }))`
4. 持久化（写入失败必须抛出异常，让业务事务回滚，保证资金已动则审计必留痕）

校验流程（`AuditLogService.verifyChain`）：按 `seq` 升序分页迭代，逐条校验 `previousHash` 链接与内容哈希，发现首条异常返回其 `id`。`AuditSchedule` 每天凌晨 3 点执行全量校验，异常时创建 `RiskEvent` 告警。

### 幂等键设计

所有外部可重试的资金类操作必须支持幂等，通过 `idempotencyKey` 字段实现：

| 模型 | 幂等字段 | 说明 |
|------|----------|------|
| `TransactionOrder` | `idempotencyKey` (@unique) | 转账、充值等 |
| `WithdrawalOrder` | `idempotencyKey` (@unique) | 提现 |
| `RedPacket` | `idempotencyKey` (@unique) | 发红包 |
| `EscrowOrder` | `idempotencyKey` (@unique) | 担保交易 |
| `BatchTransfer` | `idempotencyKey` (@unique) | 批量转账批次 |
| `Subscription` | `idempotencyKey` (@unique) | 订阅 |
| `SplitOrder` | `idempotencyKey` (@unique) | 分账 |
| `PaymentOrder` | `idempotencyKey` (@unique) + `@@unique([merchantId, merchantOrderNo])` | 商户订单号唯一 |

客户端重试时传入相同 `idempotencyKey`，数据库唯一约束保证只成功一次，重复请求返回首次结果。

### 软删除约定

项目采用「状态字段」软删除而非 `deletedAt` 时间戳，便于查询过滤与审计：

| 模型 | 软删除字段 | 取值 |
|------|------------|------|
| `BankCard` | `status` | `ACTIVE` / `DELETED`（解绑即置 DELETED，isDefault 自动转移） |
| `User` | `status` | `ACTIVE` / `FROZEN` 等 |
| `Merchant` | `status` | `PENDING` / `APPROVED` / `REJECTED` |
| `Message` | 实际删除（`prisma.message.delete`） | 广播消息不可删，仅定向消息可由用户删除 |

查询时必须显式过滤 `status`，避免返回已删除数据。

### 索引约定

Prisma schema 中通过 `@@index` 声明索引，遵循以下原则：

1. **外键字段必加索引**：如 `TransactionOrder.fromUserId` / `toUserId`、`AccountLedger.accountId` / `transactionId`
2. **状态 + 时间复合索引**：用于调度任务扫描超时订单，如 `@@index([status, completedAt])`、`@@index([status, expiredAt])`、`@@index([status, shippedAt])`
3. **渠道订单号索引**：用于回调匹配，如 `@@index([channelOrderNo])`
4. **用户视角查询索引**：如 `Bill.@@index([userId, createdAt])` 用于分页查询用户账单
5. **幂等键 / 业务唯一约束**：使用 `@unique` 或 `@@unique`，如 `@@unique([merchantId, merchantOrderNo])`、`@@unique([messageId, userId])`

---

## 权限系统详解

权限系统由 `src/admin/permissions.decorator.ts` 与 `src/admin/permissions.guard.ts` 实现，基于「角色 → 权限码」映射，通过装饰器声明端点所需权限，Guard 在运行时校验 JWT 中的 `role`。

### 11 种权限码

| 权限码 | 说明 |
|--------|------|
| `account:adjust` | 人工调账（`POST /admin/accounts/:userId/adjust`） |
| `withdrawal:audit` | 提现审核（通过/拒绝提现申请） |
| `reconciliation:run` | 执行对账、拉取渠道对账单、触发匹配 |
| `reconciliation:diff:handle` | 对账差异处理（指派处理人、标记解决） |
| `finance:view` | 财务数据查看（概览、日报、结算、快照、对账报告） |
| `identity:audit` | 实名认证审核（通过/拒绝） |
| `merchant:audit` | 商户审核、发票开具/作废 |
| `user:status` | 修改用户状态（冻结/解冻） |
| `risk:config` | 风控规则配置、自定义规则 CRUD |
| `risk:event:handle` | 风控事件处理 |
| `admin:view` | 通用查询权限，所有后台角色均可读管理后台基础数据 |

### 4 种角色

`ROLE_PERMISSIONS` 定义了各角色拥有的权限集合，`SUPER_ADMIN` 自动拥有所有权限（`'*'` 通配）：

| 角色 | 权限集合 |
|------|----------|
| `SUPER_ADMIN` | `'*'`（自动拥有所有权限） |
| `FINANCE` | `account:adjust`、`withdrawal:audit`、`reconciliation:run`、`reconciliation:diff:handle`、`finance:view`、`admin:view` |
| `CUSTOMER_SERVICE` | `identity:audit`、`merchant:audit`、`user:status`、`admin:view` |
| `RISK_OFFICER` | `risk:config`、`risk:event:handle`、`admin:view` |

```typescript
export const ROLE_PERMISSIONS: Record<AdminRole, Permission[] | '*'> = {
  SUPER_ADMIN: '*',
  FINANCE: ['account:adjust', 'withdrawal:audit', 'reconciliation:run',
            'reconciliation:diff:handle', 'finance:view', 'admin:view'],
  CUSTOMER_SERVICE: ['identity:audit', 'merchant:audit', 'user:status', 'admin:view'],
  RISK_OFFICER: ['risk:config', 'risk:event:handle', 'admin:view'],
}
```

### @RequirePermissions 装饰器

在 Controller 方法上声明所需权限，**多个权限为 OR 关系**（拥有其中任一即可通过）：

```typescript
import { RequirePermissions } from '../admin/permissions.decorator'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'

@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
@RequirePermissions('reconciliation:run', 'reconciliation:diff:handle')
@Post('admin/channel-reconciliation/differences/:id/resolve')
async resolveDifference(...) { ... }
```

`@RequirePermissions` 通过 `SetMetadata(PERMISSIONS_KEY, permissions)` 把权限码挂到路由元数据上，供 Guard 读取。

### PermissionsGuard 工作原理

`PermissionsGuard` 与 `AdminJwtAuthGuard` 组合使用：`AdminJwtAuthGuard` 负责认证（解析 JWT、注入 `request.user`），`PermissionsGuard` 负责对带 `@RequirePermissions()` 的端点做权限校验。

```mermaid
flowchart LR
    A[请求到达] --> B[AdminJwtAuthGuard<br/>认证 JWT]
    B -->|失败| C[401 Unauthorized]
    B -->|成功| D[PermissionsGuard<br/>读取路由元数据]
    D --> E{端点声明了<br/>@RequirePermissions?}
    E -->|否| F[放行]
    E -->|是| G[读取 request.user.role]
    G --> H{hasPermission role, p}
    H -->|任一权限匹配| F
    H -->|全部不匹配| I[403 Forbidden<br/>当前角色无该操作权限]
```

`hasPermission(role, permission)` 逻辑：若角色权限为 `'*'` 直接返回 `true`，否则检查 `permissions.includes(permission)`。

---

## 可观测性

KeBaiPay 提供四层可观测性能力：分布式追踪、指标暴露、异常告警、结构化日志。所有组件均通过环境变量启用，未配置时为零开销 no-op。

### OpenTelemetry 接入（tracing.ts）

文件：`src/tracing.ts`

- 必须在 `NestFactory.create` 之前 `import`，使 `auto-instrumentation` 能 patch HTTP/Express/PG/ioredis 等模块
- 启用方式：设置 `OTEL_EXPORTER_OTLP_ENDPOINT`（如 `http://otel-collector:4318`）
- 通过 `OTLPTraceExporter` 以 OTLP HTTP 协议导出 span
- 资源属性：`service.name`（默认 `kebaipay`）、`service.version`、`deployment.environment`
- 自动禁用 fs / dns instrumentation，避免低价值 span 噪声
- 进程退出时 `SIGTERM` / `SIGINT` 触发 `sdk.shutdown()`，flush 残留 span
- 推荐后端：Jaeger / Tempo / Grafana Alloy / Honeycomb / Datadog（兼容 OTLP）

### Prometheus /metrics 端点（metrics/）

模块：`src/metrics/`

- 端点：`GET /metrics`，返回 Prometheus 文本格式（`text/plain; version=0.0.4`）
- `@SkipThrottle()` 避免抓取被限流，不经过 `ResponseTransformInterceptor` 包装
- 指标三类：
  - Node.js 运行时默认指标（GC、事件循环、内存、CPU、`process_start_time_seconds`）
  - `http_requests_total{method,route,status}`：HTTP 请求计数器
  - `http_request_duration_seconds{method,route}`：HTTP 请求延迟直方图（buckets 覆盖 1ms ~ 10s）
  - `http_request_in_flight{method,route}`：当前处理中请求数 Gauge
- 使用独立 `Registry`，避免与其他库的全局注册冲突
- 生产环境建议通过反向代理或网络策略限制 `/metrics` 仅内网可访问

### Sentry 异常告警

通过环境变量 `SENTRY_DSN` 配置（见 `.env.example`）：

```bash
# Sentry 异常告警：未配置 SDK_DSN 时不启用
SENTRY_DSN=""
```

未配置 DSN 时不启用，零开销。配置后将未捕获异常上报至 Sentry，便于运维及时介入。

### 结构化 JSON 日志（JsonLogger）

文件：`src/common/json-logger.ts`

实现 NestJS `LoggerService` 接口，不依赖 pino/winston：

- **生产环境**（`NODE_ENV=production`）：输出 JSON 行，便于 ELK/Loki 等日志系统解析与检索
- **开发环境**：回退到彩色文本格式，便于本地调试

每条日志字段：

| 字段 | 说明 |
|------|------|
| `timestamp` | ISO8601 时间戳 |
| `level` | DEBUG / INFO / WARN / ERROR |
| `context` | Logger 实例名（通常是 service 类名） |
| `message` | 日志消息 |
| `traceId` | 链路 ID（来自 AsyncLocalStorage，无则省略） |
| `stack` | 错误堆栈（仅 error 级别） |

### traceId 自动注入（trace-context.ts）

文件：`src/common/trace-context.ts`

基于 Node.js `AsyncLocalStorage` 实现请求级 traceId 传播：

1. `RequestLoggingMiddleware` 在请求入口生成 `traceId`，通过 `runWithTraceId(traceId, fn)` 包装请求处理链
2. `patchLoggerWithTraceId()` 在应用启动时 monkey-patch `Logger.prototype` 的 `log/warn/error/debug/verbose` 方法
3. service 层调用 `logger.log(...)` 时自动从 `AsyncLocalStorage` 取出 `traceId` 注入到日志前缀 `[traceId]`
4. 上下文自动跨越 `async/await` 调用链，service 层无需手动拼接

> 注意：AsyncLocalStorage 不会传播到 `setTimeout` / `setInterval` 等显式创建的异步任务。回调类异步（如 `res.on('finish')`）应在创建回调时闭包捕获 `traceId`，不依赖 ALS。

---

## 认证方式

KeBaiPay 提供三种认证方式，适用于不同场景：

### 用户 JWT 认证

用于普通用户操作（转账、提现、查看账单等）。

**获取 Token：**
```http
POST /auth/login
Content-Type: application/json

{
  "phone": "13800138000",
  "password": "YourPassword123"
}
```

**响应：**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "nickname": "用户昵称"
  }
}
```

**使用 Token：**
```http
GET /users/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 管理员认证

用于管理后台操作（审核商户、处理提现等）。

```http
POST /admin/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123456"
}
```

### 商户 HMAC 签名认证

用于商户开放 API 调用（创建订单、退款、转账等）。

**签名算法：HMAC-SHA256**

签名字符串格式：
```
{HTTP方法}\n{请求路径}\n{请求体}\n{时间戳}\n{随机数}\n{应用ID}
```

**必需请求头：**

| Header | 说明 |
|--------|------|
| `X-App-Id` | 商户应用 App ID |
| `X-Timestamp` | 当前时间戳（毫秒） |
| `X-Nonce` | 唯一随机字符串（防重放） |
| `X-Signature` | HMAC-SHA256 签名值（hex） |

**签名示例：**
```javascript
const crypto = require('crypto')

const method = 'POST'
const path = '/open-api/v1/orders'
const rawBody = JSON.stringify({
  merchantOrderNo: 'ORDER_20240101_001',
  amount: 99.99,
  subject: '测试商品'
})
const timestamp = Date.now().toString()
const nonce = 'random_nonce_123'
const appId = 'your_app_id'
const appSecret = 'your_app_secret'

const signString = `${method}\n${path}\n${rawBody}\n${timestamp}\n${nonce}\n${appId}`
const signature = crypto
  .createHmac('sha256', appSecret)
  .update(signString)
  .digest('hex')
```

---

## API 端点索引

KeBaiPay v2.0.0 共暴露 **204 个端点，覆盖 35 个模块**。完整端点列表（请求体、响应、错误码、分页指南、错误处理）已迁移至独立的 [API_REFERENCE.md](./API_REFERENCE.md)，本指南不再重复维护。

### 端点分布概览

| 模块分类 | 路由前缀 | 端点数 | 认证 |
|----------|----------|--------|------|
| 用户侧基础 | `/auth`、`/users`、`/accounts`、`/transactions`、`/transfers`、`/withdrawals`、`/bills`、`/qr-codes` | ~30 | 用户 JWT |
| 用户侧 v2.0 新增 | `/bank-cards`、`/escrow`、`/batch-transfers`、`/subscriptions`、`/splits`、`/coupons`、`/referrals`、`/messages`、`/invoices`、`/risk-audit`、`/risk-rules/custom` | ~80 | 用户 JWT |
| 社交 | `/red-packets` | 4 | 用户 JWT |
| 商户 | `/merchants`、`/cashier` | ~25 | 用户 JWT |
| 商户开放 API | `/open-api/v1/*` | 5 | HMAC 签名 |
| 管理后台 | `/admin/*`、`/admin/finance/*`、`/admin/reconciliation/*`、`/admin/channel-reconciliation/*`、`/admin/risk-rules/custom/*`、`/admin/risk-audit/*`、`/admin/invoices/*` | ~60 | Admin JWT + PermissionsGuard |
| 系统接口 | `/health`、`/metrics`、`/webhooks/:channel`、`/sms/*` | ~10 | 无 / 内部 |

### 健康检查与监控端点

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/health` | 存活探针 | 无 |
| GET | `/health/ready` | 就绪探针 | 无 |
| GET | `/health/schedules` | 调度任务状态 | 无 |
| GET | `/health/channels` | 支付渠道状态 | 无 |
| GET | `/metrics` | Prometheus 指标抓取 | 无（建议内网限制） |

> 各端点的请求参数、响应结构、错误码与示例详见 [API_REFERENCE.md](./API_REFERENCE.md)。

---

## 错误码规范

所有错误返回统一格式：

```json
{
  "statusCode": 400,
  "message": "KBxxx 错误描述",
  "error": "Bad Request"
}
```

### 错误码范围

| 范围 | 说明 |
|------|------|
| KB001 ~ KB099 | 系统/通用 |
| KB100 ~ KB199 | 认证/授权/签名 |
| KB200 ~ KB299 | 用户/账户 |
| KB300 ~ KB399 | 商户 |
| KB400 ~ KB499 | 参数/请求错误 |
| KB500 ~ KB599 | 资金操作 |
| KB600 ~ KB699 | 支付订单/收银台 |
| KB700 ~ KB799 | 开放 API |
| KB800 ~ KB899 | 风控 |
| KB900 ~ KB999 | 管理后台/财务 |

### 常见错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| KB001 | 500 | 系统错误 |
| KB003 | 403 | 超出单日限额 |
| KB005 | 400 | 余额不足 |
| KB102 | 401 | 账号或密码错误 |
| KB104 | 403 | 账号已冻结 |
| KB208 | 400 | 支付密码错误 |
| KB301 | 400 | 已申请过商户 |
| KB304 | 404 | 商户不存在 |
| KB401 | 401 | 签名/认证失败 |
| KB501 | 400 | 转账金额无效 |
| KB603 | 404 | 订单不存在 |
| KB713 | 400 | 订单状态不可退款 |

---

## 频率限制

系统配置了多层频率限制：

| 场景 | 限制 | 说明 |
|------|------|------|
| 全局默认 | 100 次/分钟 | 所有 API |
| 认证接口 | 10 次/分钟 | 登录/注册 |
| 开放 API | 30 次/分钟 | 商户接口 |

超出限制返回 HTTP 429 Too Many Requests。

---

## 测试规范

### 测试目录约定

| 类型 | 位置 | 命名 | 工具 |
|------|------|------|------|
| 单元测试 | 与源码同目录 | `<file>.spec.ts` | Jest + ts-jest |
| 控制器测试 | 与源码同目录 | `<module>.controller.spec.ts` | Jest + `@nestjs/testing` |
| 并发测试 | 与源码同目录 | `concurrency.spec.ts` | Jest（仅资金类模块） |
| E2E 测试 | `test/` | `<module>.e2e-spec.ts` | Jest + supertest |
| E2E 模拟脚本 | 项目根 | `e2e_check.py` | Python 3（urllib） |

### 单元测试覆盖率要求

- **Service**：必须有 `<module>.service.spec.ts`，覆盖成功路径、参数校验、错误码、状态机迁移
- **Controller**：必须有 `<module>.controller.spec.ts`，验证路由、Guard 装配、响应格式
- **资金类模块**（transfers / withdrawals / escrow / batch-transfers / splits / subscriptions）：必须有 `concurrency.spec.ts`，模拟并发请求验证 `withLock` + `$transaction` 防止重复扣款、超扣
- **整体覆盖率**：建议行覆盖率 ≥ 80%，分支覆盖率 ≥ 70%，关键 Service（资金、加密、审计）应达 90%+

### E2E 测试约定

E2E 测试位于 `test/` 目录，使用独立 Jest 配置 `test/jest-e2e.config.js`：

| 文件 | 说明 |
|------|------|
| `test/auth.e2e-spec.ts` | 用户注册/登录/JWT 流程 |
| `test/admin-auth.e2e-spec.ts` | 管理员登录/权限校验流程 |
| `test/open-api.e2e-spec.ts` | 商户 HMAC 签名认证与开放 API |
| `test/setup-env.ts` | 测试环境初始化（数据库、Redis mock） |

`e2e_check.py` 是 Python 编写的端到端模拟脚本，覆盖前端 H5 + 管理后台主要路径，启动服务后执行 `python3 e2e_check.py` 即可运行。

### 测试命令

```bash
npm test                 # 运行所有单元测试（jest）
npm run test:watch       # watch 模式
npm run test:cov         # 生成覆盖率报告（jest --coverage）
npm run test:e2e         # 运行 E2E 测试（jest --config ./test/jest-e2e.config.js）
python3 e2e_check.py     # 运行 Python 端到端模拟脚本（需先启动服务）
```

---

## 调度任务（@nestjs/schedule）

所有定时任务基于 `@nestjs/schedule` 的 `@Cron` 装饰器，多实例部署时通过 `RedisService.withLock` 串行化，拿不到锁的实例静默跳过。任务状态通过 `ScheduleHealthService` 注册并上报，可在 `GET /health/schedules` 查询。

### 调度任务列表

| 调度任务 | Cron 表达式 | 说明 |
|----------|-------------|------|
| `cashier:closeExpired`（`src/cashier/cashier.schedule.ts`） | `0 */5 * * * *`（每 5 分钟） | 关闭过期未支付的收银台订单，复用 service 逻辑避免重复代码 |
| `finance:dailySnapshot`（`src/finance/finance.schedule.ts`） | `0 1 * * *`（每天 01:00） | 生成前一天的 `DailySnapshot` 财务快照，多实例下通过 `sched:snapshot:{date}` 锁串行化 |
| `finance:reconciliation`（`src/finance/reconciliation.schedule.ts`） | `0 2 * * *`（每天 02:00） | 执行前一天对账 + 补跑最近 7 天缺失的对账与快照；对账失败时创建 `RiskEvent` 告警 |
| `transactions:rechargeTimeout`（`src/transactions/transactions.schedule.ts`） | `0 */5 * * * *`（每 5 分钟） | 扫描 PENDING 超过 15 分钟的充值订单告警，防止回调丢失导致订单卡死 |
| `withdrawals:processingTimeout`（`src/withdrawals/withdrawals.schedule.ts`） | `0 */5 * * * *`（每 5 分钟） | 扫描 PROCESSING 超过 10 分钟的提现订单，调用渠道 `queryPayout` 核对真实状态 |
| `red-packets:expire`（`src/red-packets/red-packets.schedule.ts`） | `0 */5 * * * *`（每 5 分钟） | 扫描过期红包（PENDING / PARTIALLY_RECEIVED），调用 `expireReturn` 退回剩余金额 |
| `coupons:auto-expire`（`src/coupons/coupons.schedule.ts`） | `0 0 * * * *`（每小时整点） | 扫描过期优惠券标记为 EXPIRED |
| `subscriptions:auto-charge`（`src/subscriptions/subscriptions.schedule.ts`） | `0 */5 * * * *`（每 5 分钟） | 扫描 `nextChargeAt` 到期的订阅执行自动扣款 |
| `escrow:auto-expire`（`src/escrow/escrow.schedule.ts`） | `0 */5 * * * *`（每 5 分钟） | 担保订单超时未付款自动取消（CREATED → EXPIRED） |
| `escrow:auto-confirm`（`src/escrow/escrow.schedule.ts`） | `0 0 * * * *`（每小时整点） | 担保订单 SHIPPED 超过 7 天未确认收货自动放款 |
| `audit:verifyChain`（`src/audit/audit.schedule.ts`） | `0 3 * * *`（每天 03:00） | 全量校验 `AdminOperationLog` 哈希链完整性，发现异常创建 `RiskEvent` 告警 |

> 此外 `src/notifications/settlement.schedule.ts` 提供结算通知相关调度（如商户结算完成通知），具体规则参见源码。

### 调度互斥锁约定

| 场景 | 锁 Key | TTL |
|------|--------|-----|
| 财务快照 | `sched:snapshot:{date}` | 5 分钟 |
| 对账 | `sched:reconcile:{date}` | 5 分钟 |
| 充值超时扫描 | `sched:recharge:timeout` | 5 分钟 |
| 提现超时扫描 | `sched:withdrawal:timeout` | 5 分钟 |

无 Redis 的单实例环境（本地开发/测试）跳过分布式锁直接执行，无多实例并发风险。

---

## 常见问题

### Q: 如何获取 appSecret？

在管理后台创建应用后，appSecret 仅显示一次，请妥善保管。如需重新获取，请使用重新生成密钥接口。

### Q: 回调地址有什么要求？

- 必须是 http 或 https 协议
- 不允许指向内网地址（localhost、127.0.0.1、10.x.x.x 等）
- 格式必须有效

### Q: Redis 不配置会怎样？

系统会自动降级：
- nonce 防重放降级为进程内 Map（仅单实例有效）
- 分布式锁降级为无锁模式

生产环境强烈建议配置 Redis。

### Q: 如何验证回调签名？

详见 [SDK 使用指南](./SDK_GUIDE.md) 中的 Webhook 签名验证章节。

### Q: 支付密码锁定后如何解锁？

支付密码连续错误 5 次将锁定 15 分钟，锁定期间无法使用支付密码进行任何操作。等待 15 分钟后自动解锁。
