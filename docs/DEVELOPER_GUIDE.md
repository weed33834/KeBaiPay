# KeBaiPay 开发者指南

> 科佰支付 - 个人钱包 + 商户收款平台

## 目录

- [快速开始](#快速开始)
- [项目架构](#项目架构)
- [认证方式](#认证方式)
  - [用户 JWT 认证](#用户-jwt-认证)
  - [管理员认证](#管理员认证)
  - [商户 HMAC 签名认证](#商户-hmac-签名认证)
- [完整 API 端点](#完整-api-端点)
- [错误码规范](#错误码规范)
- [频率限制](#频率限制)
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
# 1. 克隆项目
git clone https://github.com/your-org/kebaipay.git
cd kebaipay

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
├── auth/              # 用户认证（注册、登录、JWT）
├── users/             # 用户管理（实名认证、支付密码）
├── accounts/          # 账户余额、资金流水
├── transactions/      # 充值交易
├── transfers/         # 用户间转账
├── withdrawals/       # 提现申请与审核
├── red-packets/       # 红包功能
├── qr-codes/          # 个人收款码
├── bills/             # 账单查询
├── merchants/         # 商户管理（入驻、应用、收款码）
├── cashier/           # 收银台（创建订单、支付、对账）
├── open-api/          # 商户开放 API（HMAC 签名认证）
├── admin/             # 管理后台（用户/商户/提现审核、风控、系统配置）
├── finance/           # 财务模块（结算、对账、快照、报表）
├── webhooks/          # 回调通知
├── payment-channels/  # 支付渠道（支付宝、微信）
├── risk/              # 风控引擎
├── security/          # 安全模块
├── audit/             # 审计日志
├── health/            # 健康检查
├── redis/             # Redis 服务
├── prisma/            # 数据库 ORM
└── common/            # 公共工具（错误码、枚举、分页、加解密）
```

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

## 完整 API 端点

### 认证接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/auth/register` | 用户注册 | 无 |
| POST | `/auth/login` | 用户登录 | 无 |

### 用户接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/users/me` | 获取当前用户信息 | JWT |
| POST | `/users/verify-identity` | 提交实名认证 | JWT |
| POST | `/users/reset-pay-password` | 重置支付密码 | JWT |
| GET | `/users/daily-limit` | 查询当日限额 | JWT |

### 账户接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/accounts/me` | 获取账户余额与流水 | JWT |

### 交易接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/transactions/recharge` | 账户充值 | JWT |

### 转账接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/transfers` | 用户间转账 | JWT |

### 提现接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/withdrawals` | 申请提现 | JWT |
| GET | `/withdrawals` | 查询提现记录 | JWT |

### 红包接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/red-packets` | 发红包 | JWT |
| POST | `/red-packets/:packetNo/receive` | 领红包 | JWT |
| GET | `/red-packets/sent` | 已发红包列表 | JWT |
| GET | `/red-packets/received` | 已收红包列表 | JWT |

### 收款码接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/qr-codes/personal` | 获取个人收款码 | JWT |
| POST | `/qr-codes/fixed` | 创建固定金额收款码 | JWT |
| POST | `/qr-codes/pay` | 扫码付款 | JWT |

### 账单接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/bills` | 查询账单列表 | JWT |

### 商户接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/merchants/register` | 商户入驻申请 | JWT |
| GET | `/merchants/me` | 获取商户信息 | JWT |
| PATCH | `/merchants/me` | 更新商户资料 | JWT |
| POST | `/merchants/apps` | 创建应用 | JWT |
| GET | `/merchants/apps` | 列出应用 | JWT |
| POST | `/merchants/apps/:appId/regenerate-secret` | 重新生成密钥 | JWT |
| GET | `/merchants/dashboard` | 商户数据看板 | JWT |
| POST | `/merchants/qrcodes` | 创建收款码 | JWT |
| GET | `/merchants/qrcodes` | 列出收款码 | JWT |
| DELETE | `/merchants/qrcodes/:id` | 删除收款码 | JWT |

### 收银台接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/cashier/orders` | 创建收银台订单 | JWT |
| GET | `/cashier/orders` | 查询我的订单 | JWT |
| GET | `/cashier/orders/export` | 导出订单 CSV | JWT |
| GET | `/cashier/orders/reconciliation` | 对账查询 | JWT |
| GET | `/cashier/orders/:orderNo` | 查询订单详情 | JWT |
| POST | `/cashier/orders/:orderNo/pay` | 支付订单 | JWT |
| POST | `/cashier/orders/:orderNo/notify` | 重试回调通知 | JWT |
| GET | `/cashier/qrcode/:code` | 扫码获取收款信息 | 无 |

### 开放 API（HMAC 签名认证）

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/open-api/v1/orders` | 创建收款订单 | HMAC |
| GET | `/open-api/v1/orders/:orderNo` | 查询订单 | HMAC |
| POST | `/open-api/v1/refunds` | 申请退款 | HMAC |
| POST | `/open-api/v1/transfers` | 商户转账 | HMAC |
| GET | `/open-api/v1/balance` | 查询商户余额 | HMAC |

### 管理后台接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/admin/auth/login` | 管理员登录 | 无 |
| POST | `/admin/auth/change-password` | 修改管理员密码 | Admin JWT |
| GET | `/admin/dashboard` | 管理后台数据概览 | Admin JWT |
| GET | `/admin/users` | 用户列表（分页） | Admin JWT |
| GET | `/admin/users/:id` | 用户详情 | Admin JWT |
| POST | `/admin/users/:id/status` | 修改用户状态 | Admin JWT |
| POST | `/admin/users/:id/risk-level` | 修改用户风控等级 | Admin JWT |
| GET | `/admin/merchants` | 商户列表（分页） | Admin JWT |
| POST | `/admin/merchants/:id/audit` | 审核商户 | Admin JWT |
| POST | `/admin/merchants/:id/config` | 修改商户配置 | Admin JWT |
| GET | `/admin/withdrawals` | 提现审核列表 | Admin JWT |
| POST | `/admin/withdrawals/:id/approve` | 通过提现申请 | Admin JWT |
| POST | `/admin/withdrawals/:id/reject` | 拒绝提现申请 | Admin JWT |
| GET | `/admin/payment-orders` | 支付订单列表 | Admin JWT |
| GET | `/admin/risk-events` | 风控事件列表 | Admin JWT |
| POST | `/admin/risk-events/:id/handle` | 处理风控事件 | Admin JWT |
| GET | `/admin/login-logs` | 登录日志 | Admin JWT |
| GET | `/admin/identity/pending` | 待审核实名列表 | Admin JWT |
| POST | `/admin/identity/:id/approve` | 通过实名认证 | Admin JWT |
| POST | `/admin/identity/:id/reject` | 拒绝实名认证 | Admin JWT |
| POST | `/admin/accounts/:userId/adjust` | 人工调账 | Admin JWT |
| GET | `/admin/audit-logs` | 操作审计日志 | Admin JWT |
| GET | `/admin/system-configs` | 获取系统配置 | Admin JWT |
| POST | `/admin/system-configs` | 设置系统配置 | Admin JWT |
| GET | `/admin/risk-rules` | 获取风控规则 | Admin JWT |
| PUT | `/admin/risk-rules/:code` | 更新风控规则 | Admin JWT |
| GET | `/admin/admin-users` | 管理员列表 | Admin JWT |
| POST | `/admin/admin-users` | 创建管理员 | Admin JWT |
| PUT | `/admin/admin-users/:id` | 更新管理员 | Admin JWT |
| DELETE | `/admin/admin-users/:id` | 删除管理员 | Admin JWT |
| POST | `/admin/admin-users/:id/reset-password` | 重置管理员密码 | Admin JWT |
| GET | `/admin/channels` | 支付渠道列表 | Admin JWT |
| POST | `/admin/channels` | 创建支付渠道 | Admin JWT |
| PUT | `/admin/channels/:code` | 更新支付渠道 | Admin JWT |
| DELETE | `/admin/channels/:code` | 删除支付渠道 | Admin JWT |
| POST | `/admin/channels/:code/test` | 测试支付渠道 | Admin JWT |

### 财务接口

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/admin/finance/overview` | 财务概览 | Admin JWT |
| GET | `/admin/finance/daily-summary` | 每日收支汇总 | Admin JWT |
| GET | `/admin/finance/daily-summary/export` | 导出每日汇总 CSV | Admin JWT |
| GET | `/admin/finance/merchant-settlements` | 商户结算明细 | Admin JWT |
| GET | `/admin/finance/merchant-settlements/export` | 导出商户结算 CSV | Admin JWT |
| GET | `/admin/finance/fee-income` | 手续费收入统计 | Admin JWT |
| GET | `/admin/finance/fee-income/export` | 导出手续费 CSV | Admin JWT |
| GET | `/admin/finance/daily-snapshots` | 每日资产快照 | Admin JWT |
| GET | `/admin/finance/snapshots/export` | 导出资产快照 CSV | Admin JWT |
| POST | `/admin/finance/snapshots/generate` | 手动生成每日快照 | Admin JWT |
| GET | `/admin/finance/settlement/unfinished` | 未结算订单汇总 | Admin JWT |
| POST | `/admin/finance/settlement/run` | 手动执行结算 | Admin JWT |
| POST | `/admin/reconciliation/run` | 执行对账 | Admin JWT |
| GET | `/admin/reconciliation/reports` | 对账报告列表 | Admin JWT |
| GET | `/admin/reconciliation/reports/export` | 导出对账报告 CSV | Admin JWT |
| GET | `/admin/reconciliation/reports/:date` | 查询指定日期对账报告 | Admin JWT |

### 健康检查

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| GET | `/health` | 存活探针 | 无 |
| GET | `/health/ready` | 就绪探针 | 无 |
| GET | `/health/schedules` | 调度任务状态 | 无 |
| GET | `/health/channels` | 支付渠道状态 | 无 |

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
