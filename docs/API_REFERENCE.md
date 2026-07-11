# KeBaiPay API 参考文档

> 完整的 REST API 端点列表、请求/响应格式及认证详情

## 目录

- [基础信息](#基础信息)
- [认证方式](#认证方式)
- [端点列表](#端点列表)
  - [认证接口](#认证接口)
  - [用户接口](#用户接口)
  - [账户接口](#账户接口)
  - [交易接口](#交易接口)
  - [转账接口](#转账接口)
  - [提现接口](#提现接口)
  - [红包接口](#红包接口)
  - [收款码接口](#收款码接口)
  - [账单接口](#账单接口)
  - [商户接口](#商户接口)
  - [收银台接口](#收银台接口)
  - [开放 API](#开放-api)
  - [健康检查](#健康检查)
  - [管理后台](#管理后台)
  - [财务接口](#财务接口)
- [错误码表](#错误码表)
- [分页指南](#分页指南)
- [频率限制](#频率限制)
- [错误处理](#错误处理)

---

## 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `http://localhost:3000` |
| Swagger 文档 | `http://localhost:3000/api/docs`（仅开发环境） |
| Content-Type | `application/json` |
| 金额单位 | 接口：元（Yuan），数据库：分（Fen） |

---

## 认证方式

### 用户 JWT 认证

```
Authorization: Bearer <token>
```

### 管理员 JWT 认证

```
Authorization: Bearer <admin_token>
```

### 商户 HMAC 签名认证

```
X-App-Id: <app_id>
X-Timestamp: <timestamp_ms>
X-Nonce: <unique_nonce>
X-Signature: <hmac_sha256_hex>
```

签名算法：
```
sign_string = HTTP_METHOD\nPATH\nRAW_BODY\nTIMESTAMP\nNONCE\nAPP_ID
signature = HMAC-SHA256(app_secret, sign_string)
```

---

## 端点列表

### 认证接口

#### POST /auth/register

用户注册。

**请求体：**
```json
{
  "nickname": "用户昵称",
  "phone": "13800138000",
  "email": "user@example.com",
  "password": "Password123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| nickname | string | 是 | 昵称，1-32 字符 |
| phone | string | 否 | 手机号（phone 和 email 至少提供一个） |
| email | string | 否 | 邮箱 |
| password | string | 是 | 密码，至少 8 位，包含大写字母、小写字母、数字中的至少两类 |

**响应 201：**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "nickname": "用户昵称"
  }
}
```

---

#### POST /auth/login

用户登录。

**请求体：**
```json
{
  "phone": "13800138000",
  "email": "user@example.com",
  "password": "Password123"
}
```

**响应 200：**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "nickname": "用户昵称"
  }
}
```

---

### 用户接口

#### GET /users/me 🔒

获取当前登录用户信息。

**响应 200：**
```json
{
  "id": "uuid",
  "nickname": "用户昵称",
  "phone": "138****8000",
  "email": "u***@example.com",
  "avatar": null,
  "status": "ACTIVE",
  "realNameStatus": "UNVERIFIED"
}
```

---

#### POST /users/verify-identity 🔒

提交实名认证。

**请求体：**
```json
{
  "realName": "张三",
  "idCard": "110101199001011234"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| realName | string | 是 | 真实姓名 |
| idCard | string | 是 | 身份证号码 |

**响应 201：** 提交成功，进入审核

---

#### POST /users/reset-pay-password 🔒

重置支付密码。

**请求体：**
```json
{
  "oldPassword": "old_pay_password",
  "newPassword": "new_pay_password"
}
```

**响应 200：** 重置成功

---

#### GET /users/daily-limit 🔒

查询当日限额使用情况。

**响应 200：**
```json
{
  "CASHIER": {
    "usedAmount": 50000,
    "limit": 200000,
    "remaining": 150000
  }
}
```

---

### 账户接口

#### GET /accounts/me 🔒

获取当前用户账户信息（余额 + 资金流水）。

**响应 200：**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "availableBalanceYuan": "100.00",
  "frozenBalanceYuan": "0.00",
  "totalBalanceYuan": "100.00",
  "status": "ACTIVE",
  "ledgers": [
    {
      "id": "uuid",
      "type": "RECHARGE",
      "amountYuan": "100.00",
      "balanceBeforeYuan": "0.00",
      "balanceAfterYuan": "100.00",
      "direction": "DEBIT",
      "remark": "充值",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 交易接口

#### POST /transactions/recharge 🔒

账户充值。

**请求体：**
```json
{
  "amount": 100.00,
  "payPassword": "pay_password",
  "idempotencyKey": "unique_key_123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| amount | number | 是 | 充值金额（元），> 0 |
| payPassword | string | 是 | 支付密码 |
| idempotencyKey | string | 否 | 幂等键，防止重复充值 |

**响应 201：**
```json
{
  "orderNo": "TX20240101000001",
  "status": "PENDING",
  "amountYuan": "100.00"
}
```

---

### 转账接口

#### POST /transfers 🔒

用户间转账。

**请求体：**
```json
{
  "toUserId": "target_user_uuid",
  "amount": 50.00,
  "payPassword": "pay_password",
  "remark": "转账备注"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toUserId | string | 是 | 收款用户 ID |
| amount | number | 是 | 转账金额（元），> 0 |
| payPassword | string | 是 | 支付密码 |
| remark | string | 否 | 备注 |

**响应 201：** 转账成功

**错误响应：**
- 400 KB501 转账金额无效
- 400 KB502 不能给自己转账
- 400 KB005 余额不足
- 403 KB214 对方未实名

---

### 提现接口

#### POST /withdrawals 🔒

申请提现。

**请求体：**
```json
{
  "amount": 50.00,
  "payPassword": "pay_password",
  "channel": "BANK",
  "channelAccount": "6222021234567890123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| amount | number | 是 | 提现金额（元），> 0 |
| payPassword | string | 是 | 支付密码 |
| channel | string | 否 | 提现渠道，默认 BANK |
| channelAccount | string | 否 | 收款账号 |

**响应 201：** 提现订单创建成功，等待审核

---

#### GET /withdrawals 🔒

查询提现记录。

**响应 200：**
```json
[
  {
    "id": "uuid",
    "orderNo": "WD20240101000001",
    "amount": 5000,
    "fee": 0,
    "actualAmount": 5000,
    "status": "PENDING",
    "channel": "BANK",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### 红包接口

#### POST /red-packets 🔒

发红包。

**请求体：**
```json
{
  "amount": 10.00,
  "count": 5,
  "remark": "恭喜发财",
  "expiresAt": "2024-01-02T00:00:00.000Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| amount | number | 是 | 红包总金额（元） |
| count | number | 是 | 红包个数 |
| remark | string | 否 | 祝福语 |
| expiresAt | string | 否 | 过期时间 |

**响应 201：** 红包创建成功

---

#### POST /red-packets/:packetNo/receive 🔒

领取红包。

**响应 200：** 领取成功

---

#### GET /red-packets/sent 🔒

查询已发红包列表。

#### GET /red-packets/received 🔒

查询已收红包列表。

---

### 收款码接口

#### GET /qr-codes/personal 🔒

获取个人收款码。

**响应 200：**
```json
{
  "id": "uuid",
  "code": "QR_xxxxx",
  "type": "PERSONAL",
  "status": "ACTIVE"
}
```

---

#### POST /qr-codes/fixed 🔒

创建固定金额收款码。

**请求体：**
```json
{
  "amount": 10.00,
  "remark": "午餐费"
}
```

**响应 201：** 收款码创建成功

---

#### POST /qr-codes/pay 🔒

扫码付款。

**请求体：**
```json
{
  "code": "QR_xxxxx",
  "payPassword": "pay_password"
}
```

**响应 201：** 付款成功

---

### 账单接口

#### GET /bills 🔒

查询账单列表。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| direction | string | 否 | INCOME（收入）/ EXPENSE（支出） |

**响应 200：**
```json
[
  {
    "id": "uuid",
    "type": "TRANSFER",
    "direction": "INCOME",
    "amountYuan": "50.00",
    "counterparty": "张三",
    "remark": "转账",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### 商户接口

#### POST /merchants/register 🔒

商户入驻申请。

**请求体：**
```json
{
  "merchantName": "我的店铺",
  "merchantType": "PERSONAL",
  "contactName": "张三",
  "contactPhone": "13800138000"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| merchantName | string | 是 | 商户名称 |
| merchantType | string | 是 | 商户类型：PERSONAL / ENTERPRISE |
| contactName | string | 是 | 联系人姓名 |
| contactPhone | string | 是 | 联系电话 |

**响应 201：** 申请提交成功，等待审核

---

#### GET /merchants/me 🔒

获取当前商户信息。

**响应 200：**
```json
{
  "id": "uuid",
  "merchantNo": "M20240101001",
  "merchantName": "我的店铺",
  "status": "APPROVED",
  "payRate": 60,
  "withdrawRate": 60,
  "dailyLimit": 10000000
}
```

---

#### POST /merchants/apps 🔒

创建商户应用。

**请求体：**
```json
{
  "name": "我的应用",
  "callbackUrl": "https://your-server.com/callback"
}
```

**响应 201：**
```json
{
  "id": "uuid",
  "appId": "app_xxxxx",
  "appSecret": "secret_xxxxx",
  "name": "我的应用"
}
```

> 请妥善保管 appSecret，关闭对话框后将无法再次查看。

---

#### GET /merchants/apps 🔒

列出商户所有应用。

#### POST /merchants/apps/:appId/regenerate-secret 🔒

重新生成应用密钥（原密钥立即失效）。

#### GET /merchants/dashboard 🔒

商户数据看板（今日交易额、订单数等）。

---

### 收银台接口

#### POST /cashier/orders 🔒

创建收银台订单。

**请求体：**
```json
{
  "merchantOrderNo": "ORDER_001",
  "amount": 99.99,
  "subject": "测试商品",
  "body": "商品描述",
  "callbackUrl": "https://your-server.com/callback"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| merchantOrderNo | string | 是 | 商户订单号 |
| amount | number | 是 | 金额（元），> 0.01 |
| subject | string | 是 | 商品标题 |
| body | string | 否 | 商品描述 |
| callbackUrl | string | 否 | 回调地址 |

**响应 201：**
```json
{
  "orderNo": "PAY20240101000001",
  "cashierUrl": "http://localhost:8080/#cashier?orderNo=PAY20240101000001",
  "amountYuan": "99.99",
  "status": "PENDING",
  "expiredAt": "2024-01-01T01:00:00.000Z"
}
```

---

#### GET /cashier/orders 🔒

查询我的收银台订单。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| limit | number | 否 | 每页条数，默认 20 |
| status | string | 否 | 订单状态筛选 |

---

#### POST /cashier/orders/:orderNo/pay 🔒

支付订单。

**请求体：**
```json
{
  "payPassword": "pay_password"
}
```

**响应 200：** 支付成功

---

### 开放 API

以下接口需要 HMAC-SHA256 签名认证。

#### POST /open-api/v1/orders

创建收款订单。

**请求体：**
```json
{
  "merchantOrderNo": "ORDER_001",
  "amount": 99.99,
  "subject": "测试商品",
  "body": "商品描述",
  "callbackUrl": "https://your-server.com/callback",
  "expiredAt": "2024-01-02T00:00:00"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| merchantOrderNo | string | 是 | 商户订单号（同 app 内唯一） |
| amount | number | 是 | 金额（元），> 0.01 |
| subject | string | 是 | 商品标题 |
| body | string | 否 | 商品描述 |
| callbackUrl | string | 否 | 回调地址（需 http/https，不允许内网） |
| expiredAt | string | 否 | 过期时间，默认 30 分钟，最长 24 小时 |

**响应 201：**
```json
{
  "orderNo": "PAY20240101000001",
  "cashierUrl": "http://localhost:8080/#cashier?orderNo=PAY20240101000001",
  "amountYuan": "99.99",
  "status": "PENDING",
  "expiredAt": "2024-01-02T00:00:00.000Z"
}
```

---

#### GET /open-api/v1/orders/:orderNo

查询订单详情。

**响应 200：**
```json
{
  "orderNo": "PAY20240101000001",
  "merchantOrderNo": "ORDER_001",
  "amount": 9999,
  "amountYuan": "99.99",
  "fee": 60,
  "feeYuan": "0.60",
  "status": "PAID",
  "payerId": "uuid",
  "paidAt": "2024-01-01T00:05:00.000Z",
  "refundAmount": 0,
  "refundAmountYuan": "0.00",
  "subject": "测试商品",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

---

#### POST /open-api/v1/refunds

申请退款。

**请求体：**
```json
{
  "orderNo": "PAY20240101000001",
  "amount": 50.00,
  "reason": "部分退货",
  "idempotencyKey": "refund_001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderNo | string | 是 | 平台订单号 |
| amount | number | 否 | 退款金额（元），不传则全额退款 |
| reason | string | 否 | 退款原因 |
| idempotencyKey | string | 否 | 幂等键 |

**响应 201：**
```json
{
  "orderNo": "PAY20240101000001",
  "status": "PAID",
  "refundAmountYuan": "50.00",
  "totalRefundAmountYuan": "50.00",
  "refundableYuan": "49.39",
  "transactionNo": "R20240101000001"
}
```

---

#### POST /open-api/v1/transfers

商户转账。

**请求体：**
```json
{
  "toUserId": "target_user_uuid",
  "amount": 10.00,
  "remark": "商户转账",
  "idempotencyKey": "transfer_001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toUserId | string | 是 | 收款用户 ID |
| amount | number | 是 | 转账金额（元），> 0 |
| remark | string | 否 | 备注 |
| idempotencyKey | string | 否 | 幂等键 |

**响应 201：** 转账成功

---

#### GET /open-api/v1/balance

查询商户余额。

**响应 200：**
```json
{
  "availableYuan": "1000.00",
  "frozenYuan": "0.00",
  "totalYuan": "1000.00"
}
```

---

### 健康检查

#### GET /health

存活探针（Liveness）。

**响应 200：**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

#### GET /health/ready

就绪探针（Readiness），检查 DB 与 Redis 连通性。

**响应 200：** 所有依赖正常

**响应 503：** 依赖不可用

---

#### GET /health/schedules

调度任务健康状态。

#### GET /health/channels

支付渠道健康状态。

---

### 管理后台

#### POST /admin/auth/login

管理员登录。

**请求体：**
```json
{
  "username": "admin",
  "password": "admin123456"
}
```

**响应 200：**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

#### POST /admin/auth/change-password 🔒

修改管理员密码。

**请求体：**
```json
{
  "oldPassword": "old_password",
  "newPassword": "new_password"
}
```

---

#### GET /admin/dashboard 🔒

管理后台数据概览。

#### GET /admin/users 🔒

用户列表（分页）。

#### GET /admin/users/:id 🔒

用户详情。

#### POST /admin/users/:id/status 🔒

修改用户状态（冻结/解冻）。

#### POST /admin/users/:id/risk-level 🔒

修改用户风控等级。

#### GET /admin/merchants 🔒

商户列表（分页）。

#### POST /admin/merchants/:id/audit 🔒

审核商户（通过/拒绝）。

#### POST /admin/merchants/:id/config 🔒

修改商户配置（费率、日限额）。

#### GET /admin/withdrawals 🔒

提现审核列表。

#### POST /admin/withdrawals/:id/approve 🔒

通过提现申请。

#### POST /admin/withdrawals/:id/reject 🔒

拒绝提现申请。

#### GET /admin/payment-orders 🔒

支付订单列表。

#### GET /admin/risk-events 🔒

风控事件列表。

#### POST /admin/risk-events/:id/handle 🔒

处理风控事件。

#### GET /admin/login-logs 🔒

登录日志。

#### GET /admin/system-configs 🔒

获取系统配置。

#### POST /admin/system-configs 🔒

设置系统配置。

#### GET /admin/risk-rules 🔒

获取风控规则。

#### PUT /admin/risk-rules/:code 🔒

更新风控规则。

#### GET /admin/identity/pending 🔒

待审核实名列表。

#### POST /admin/identity/:id/approve 🔒

通过实名认证。

#### POST /admin/identity/:id/reject 🔒

拒绝实名认证。

#### POST /admin/accounts/:userId/adjust 🔒

人工调账。

#### GET /admin/audit-logs 🔒

操作审计日志。

#### GET /admin/admin-users 🔒

管理员列表。

#### POST /admin/admin-users 🔒

创建管理员。

#### PUT /admin/admin-users/:id 🔒

更新管理员。

#### DELETE /admin/admin-users/:id 🔒

删除管理员。

#### POST /admin/admin-users/:id/reset-password 🔒

重置管理员密码。

#### GET /admin/channels 🔒

支付渠道列表。

#### POST /admin/channels 🔒

创建支付渠道。

#### PUT /admin/channels/:code 🔒

更新支付渠道。

#### DELETE /admin/channels/:code 🔒

删除支付渠道。

#### POST /admin/channels/:code/test 🔒

测试支付渠道。

---

### 财务接口

#### GET /admin/finance/overview 🔒

财务概览。

#### GET /admin/finance/daily-summary 🔒

每日收支汇总。

#### GET /admin/finance/daily-summary/export 🔒

导出每日汇总 CSV。

#### GET /admin/finance/merchant-settlements 🔒

商户结算明细。

#### GET /admin/finance/merchant-settlements/export 🔒

导出商户结算 CSV。

#### GET /admin/finance/fee-income 🔒

手续费收入统计。

#### GET /admin/finance/fee-income/export 🔒

导出手续费 CSV。

#### GET /admin/finance/daily-snapshots 🔒

每日资产快照。

#### GET /admin/finance/snapshots/export 🔒

导出资产快照 CSV。

#### POST /admin/finance/snapshots/generate 🔒

手动生成每日快照。

#### GET /admin/finance/settlement/unfinished 🔒

未结算订单汇总。

#### POST /admin/finance/settlement/run 🔒

手动执行结算。

#### POST /admin/reconciliation/run 🔒

执行对账。

#### GET /admin/reconciliation/reports 🔒

对账报告列表。

#### GET /admin/reconciliation/reports/export 🔒

导出对账报告 CSV。

#### GET /admin/reconciliation/reports/:date 🔒

查询指定日期对账报告。

---

## 错误码表

### 系统/通用

| 错误码 | 说明 |
|--------|------|
| KB001 | 系统错误 |
| KB002 | 实名记录不存在 |
| KB003 | 超出单日限额 |
| KB004 | 账户不存在 |
| KB005 | 余额不足 |
| KB006 | 调账金额无效 |
| KB007 | 调账必须填写原因 |
| KB008 | 拒绝审核必须填写原因 |

### 认证/授权/签名

| 错误码 | 说明 |
|--------|------|
| KB101 | 手机号或邮箱至少提供一个 |
| KB102 | 账号或密码错误 |
| KB103 | 认证失败 |
| KB104 | 账号已冻结 |

### 用户/账户

| 错误码 | 说明 |
|--------|------|
| KB201 | 用户不存在 |
| KB202 | 已实名认证 |
| KB203 | 实名审核中 |
| KB205 | 支付密码已锁定 |
| KB206 | 未设置支付密码 |
| KB207 | 支付密码错误次数过多，已锁定 15 分钟 |
| KB208 | 支付密码错误 |
| KB209 | 未找到实名信息 |
| KB210 | 实名信息不匹配 |
| KB212 | 请先完成实名认证 |
| KB213 | 收款用户不存在 |
| KB214 | 对方未实名认证 |
| KB215 | 该实名记录不在待审核状态 |

### 商户

| 错误码 | 说明 |
|--------|------|
| KB301 | 已申请过商户 |
| KB302 | 商户信息不存在 |
| KB303 | 当前状态不可修改资料 |
| KB304 | 商户不存在 |
| KB305 | 只能审核待审核的商户 |
| KB306 | 收款费率必须在 0 ~ 10000 之间 |
| KB307 | 提现费率必须在 0 ~ 10000 之间 |
| KB308 | 日限额必须大于 0 |
| KB309 | 至少修改一个配置项 |
| KB310 | 商户未审核通过 |
| KB311 | 应用不存在 |
| KB312 | 收款码不存在 |

### 参数/请求错误

| 错误码 | 说明 |
|--------|------|
| KB400 | 通用参数错误 |
| KB401 | 签名/认证失败 |
| KB403 | 权限/风控禁止 |
| KB404 | 资源不存在 |

### 资金操作

| 错误码 | 说明 |
|--------|------|
| KB501 | 转账金额无效 |
| KB502 | 不能给自己转账 |
| KB503 | 充值金额无效 |
| KB504 | 暂无可用充值渠道 |
| KB505 | 充值渠道调用失败 |
| KB506 | 提现金额无效 |
| KB507 | 提现订单不存在 |
| KB508 | 订单状态不正确 |
| KB509 | 暂无可用代付渠道 |
| KB510 | 订单已被处理或状态已变更 |
| KB511 | 冻结余额不足，数据异常 |
| KB512 | 代付渠道调用失败 |
| KB513 | 订单状态不支持回调处理 |

### 支付订单/收银台/红包/收款码

| 错误码 | 说明 |
|--------|------|
| KB601 | 商户订单号已存在 |
| KB602 | 过期时间必须在未来 |
| KB603 | 订单不存在 |
| KB604 | 商户当前不可收款 |
| KB605 | 商户用户不存在 |
| KB606 | 订单状态已变化或已过期 |
| KB607 | 该订单未配置回调地址 |
| KB608 | 该订单已通知成功，无需重试 |
| KB609 | 非商户收款码 |
| KB610 | 收款码无效 |
| KB611 | 不能向自己的收款码付款 |
| KB612 | 商户状态异常 |
| KB613 | 红包金额必须大于 0 |
| KB614 | 红包不存在 |
| KB615 | 红包已被领取或已过期 |
| KB616 | 不能领取自己的红包 |
| KB617 | 红包已过期 |
| KB618 | 红包状态已变化 |
| KB619 | 收款码已失效 |
| KB620 | 商户二维码请通过收银台支付 |
| KB621 | 幂等键冲突 |

### 开放 API / 渠道回调

| 错误码 | 说明 |
|--------|------|
| KB701 | 回调渠道与订单渠道不匹配 |
| KB702 | 渠道订单号不匹配 |
| KB703 | 回调地址协议仅支持 http/https |
| KB704 | 回调地址不允许指向内网 |
| KB705 | 回调地址格式无效 |
| KB711 | 金额必须大于 0 |
| KB712 | 订单有效期不能超过 24 小时 |
| KB713 | 订单状态不可退款 |
| KB714 | 订单已全额退款 |
| KB715 | 退款金额必须大于 0 |
| KB716 | 退款金额超过可退金额 |
| KB717 | 应用已禁用 |

### 管理后台/财务

| 错误码 | 说明 |
|--------|------|
| KB901 | 风险事件不存在 |
| KB902 | 复式记账借贷不平衡 |
| KB910 | 管理员不存在 |
| KB911 | 用户名已存在 |
| KB912 | 不能删除自己 |
| KB913 | 旧密码错误 |
| KB914 | 配置键已存在 |
| KB915 | 配置键不存在 |
| KB916 | 权限不足，仅超级管理员可操作 |

---

## 分页指南

大部分列表接口支持分页查询，使用以下查询参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码（从 1 开始） |
| limit | number | 20 | 每页条数（最大 100） |

**分页响应格式：**

```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

**示例：**
```
GET /admin/users?page=2&limit=10
```

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

## 错误处理

### 统一错误格式

```json
{
  "statusCode": 400,
  "message": "KB400 通用参数错误",
  "error": "Bad Request"
}
```

### HTTP 状态码对照

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 请求成功 |
| 201 | 创建成功 |
| 400 | 参数错误 / 业务逻辑错误 |
| 401 | 未认证 / 签名无效 |
| 403 | 无权限 / 风控拦截 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 系统错误 |

> 🔒 表示需要认证
