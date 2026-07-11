# KeBaiPay 管理后台指南

> 管理员操作手册

## 目录

- [管理员登录](#管理员登录)
- [用户管理](#用户管理)
- [商户管理](#商户管理)
- [财务管理](#财务管理)
- [风控管理](#风控管理)
- [系统配置](#系统配置)
- [常见问题](#常见问题)

---

## 管理员登录

### 登录方式

通过管理后台 API 登录。

### 登录请求

```http
POST /admin/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123456"
}
```

### 登录响应

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 修改密码

```http
POST /admin/auth/change-password
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "oldPassword": "old_password",
  "newPassword": "new_password"
}
```

---

## 用户管理

### 查看用户列表

```http
GET /admin/users?page=1&limit=20
Authorization: Bearer <admin_token>
```

### 查看用户详情

```http
GET /admin/users/:id
Authorization: Bearer <admin_token>
```

### 冻结/解冻用户

```http
POST /admin/users/:id/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "FROZEN",
  "reason": "异常操作"
}
```

**用户状态：**

| 状态 | 说明 |
|------|------|
| ACTIVE | 正常 |
| EXPENSE_RESTRICTED | 支出受限 |
| INCOME_RESTRICTED | 收入受限 |
| FROZEN | 冻结 |

### 修改用户风控等级

```http
POST /admin/users/:id/risk-level
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "level": "HIGH"
}
```

**风控等级：**

| 等级 | 说明 |
|------|------|
| LOW | 低风险 |
| MEDIUM | 中风险 |
| HIGH | 高风险 |

### 实名认证审核

#### 查看待审核列表

```http
GET /admin/identity/pending?page=1&limit=20
Authorization: Bearer <admin_token>
```

#### 通过认证

```http
POST /admin/identity/:id/approve
Authorization: Bearer <admin_token>
```

#### 拒绝认证

```http
POST /admin/identity/:id/reject
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "身份证信息不清晰"
}
```

### 人工调账

```http
POST /admin/accounts/:userId/adjust
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "amount": 100.00,
  "reason": "系统补偿"
}
```

---

## 商户管理

### 查看商户列表

```http
GET /admin/merchants?page=1&limit=20
Authorization: Bearer <admin_token>
```

### 审核商户

```http
POST /admin/merchants/:id/audit
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "action": "APPROVE",
  "reason": ""
}
```

**审核操作：**

| 操作 | 说明 |
|------|------|
| APPROVE | 通过 |
| REJECT | 拒绝 |

### 修改商户配置

```http
POST /admin/merchants/:id/config
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "payRate": 60,
  "withdrawRate": 60,
  "dailyLimit": 10000000
}
```

**配置说明：**

| 字段 | 说明 |
|------|------|
| payRate | 收款费率（万分比） |
| withdrawRate | 提现费率（万分比） |
| dailyLimit | 日限额（分） |

---

## 财务管理

### 提现审核

#### 查看提现列表

```http
GET /admin/withdrawals?page=1&limit=20
Authorization: Bearer <admin_token>
```

#### 通过提现

```http
POST /admin/withdrawals/:id/approve
Authorization: Bearer <admin_token>
```

#### 拒绝提现

```http
POST /admin/withdrawals/:id/reject
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "信息不完整"
}
```

### 财务概览

```http
GET /admin/finance/overview
Authorization: Bearer <admin_token>
```

### 每日收支汇总

```http
GET /admin/finance/daily-summary?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

### 导出报表

```http
GET /admin/finance/daily-summary/export?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

### 商户结算

```http
GET /admin/finance/merchant-settlements?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

### 手续费统计

```http
GET /admin/finance/fee-income?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

### 资产快照

```http
GET /admin/finance/daily-snapshots?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

### 生成快照

```http
POST /admin/finance/snapshots/generate
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "date": "2024-01-01"
}
```

### 结算管理

#### 查看未结算订单

```http
GET /admin/finance/settlement/unfinished
Authorization: Bearer <admin_token>
```

#### 手动执行结算

```http
POST /admin/finance/settlement/run
Authorization: Bearer <admin_token>
```

### 对账管理

#### 执行对账

```http
POST /admin/reconciliation/run
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "date": "2024-01-01"
}
```

#### 查看对账报告

```http
GET /admin/reconciliation/reports?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

#### 导出对账报告

```http
GET /admin/reconciliation/reports/export?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <admin_token>
```

---

## 风控管理

### 查看风控事件

```http
GET /admin/risk-events?page=1&limit=20
Authorization: Bearer <admin_token>
```

### 处理风控事件

```http
POST /admin/risk-events/:id/handle
Authorization: Bearer <admin_token>
```

### 风控事件类型

| 类型 | 说明 |
|------|------|
| LARGE_TRANSFER | 大额转账 |
| LARGE_WITHDRAWAL | 大额提现 |
| LARGE_PAYMENT | 大额支付 |
| SUSPICIOUS_RED_PACKET | 可疑红包 |
| FREQUENT_TRANSACTION | 频繁交易 |
| FREQUENT_LOGIN | 频繁登录 |
| SUSPICIOUS_DEVICE | 可疑设备 |
| ACCOUNT_FROZEN | 账户冻结 |
| STATUS_CHANGED | 状态变更 |

### 查看风控规则

```http
GET /admin/risk-rules
Authorization: Bearer <admin_token>
```

### 更新风控规则

```http
PUT /admin/risk-rules/:code
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "enabled": true,
  "threshold": 10000,
  "action": "ALERT"
}
```

### 查看登录日志

```http
GET /admin/login-logs?page=1&limit=20
Authorization: Bearer <admin_token>
```

### 查看审计日志

```http
GET /admin/audit-logs?page=1&limit=20
Authorization: Bearer <admin_token>
```

---

## 系统配置

### 查看系统配置

```http
GET /admin/system-configs
Authorization: Bearer <admin_token>
```

### 设置系统配置

```http
POST /admin/system-configs
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "key": "DAILY_TRANSFER_LIMIT",
  "value": "100000000"
}
```

### 支付渠道管理

#### 查看渠道列表

```http
GET /admin/channels
Authorization: Bearer <admin_token>
```

#### 创建渠道

```http
POST /admin/channels
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "code": "ALIPAY",
  "name": "支付宝",
  "type": "BOTH",
  "config": {}
}
```

#### 更新渠道

```http
PUT /admin/channels/:code
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "enabled": true,
  "config": {}
}
```

#### 删除渠道

```http
DELETE /admin/channels/:code
Authorization: Bearer <admin_token>
```

#### 测试渠道

```http
POST /admin/channels/:code/test
Authorization: Bearer <admin_token>
```

---

## 管理员管理

### 查看管理员列表

```http
GET /admin/admin-users
Authorization: Bearer <admin_token>
```

### 创建管理员

```http
POST /admin/admin-users
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "username": "new_admin",
  "password": "password123",
  "role": "FINANCE"
}
```

**管理员角色：**

| 角色 | 说明 |
|------|------|
| SUPER_ADMIN | 超级管理员 |
| FINANCE | 财务 |
| CUSTOMER_SERVICE | 客服 |
| RISK_OFFICER | 风控 |

### 更新管理员

```http
PUT /admin/admin-users/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "role": "FINANCE",
  "status": "ACTIVE"
}
```

### 删除管理员

```http
DELETE /admin/admin-users/:id
Authorization: Bearer <admin_token>
```

### 重置管理员密码

```http
POST /admin/admin-users/:id/reset-password
Authorization: Bearer <admin_token>
```

---

## 常见问题

### Q: 如何创建新的管理员？

通过 `POST /admin/admin-users` 接口创建，需要超级管理员权限。

### Q: 管理员角色有什么区别？

- 超级管理员：所有权限
- 财务：财务相关操作
- 客服：用户管理相关操作
- 风控：风控相关操作

### Q: 如何查看操作记录？

通过 `GET /admin/audit-logs` 查看审计日志。

### Q: 人工调账会影响对账吗？

人工调账会产生调整记录，对账时会单独显示。

### Q: 如何配置风控规则？

通过 `PUT /admin/risk-rules/:code` 更新风控规则。

### Q: 结算什么时候执行？

系统每日自动执行结算，也可以手动执行。

### Q: 如何导出财务报表？

通过对应的 `/export` 接口导出 CSV 格式报表。

### Q: 支付渠道测试失败怎么办？

检查渠道配置是否正确，联系渠道服务商确认接口状态。
