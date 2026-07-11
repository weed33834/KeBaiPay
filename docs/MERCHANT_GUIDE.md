# KeBaiPay 商户指南

> 商户接入与使用手册

## 目录

- [商户注册](#商户注册)
- [应用创建](#应用创建)
- [API 集成](#api-集成)
- [订单管理](#订单管理)
- [结算管理](#结算管理)
- [常见问题](#常见问题)

---

## 商户注册

### 注册条件

- 已完成个人实名认证
- 有合法的经营资质

### 注册步骤

1. 登录 KeBaiPay 账户
2. 进入"商户中心"
3. 点击"商户入驻"
4. 填写商户信息：
   - 商户名称（必填）
   - 商户类型：个人 / 企业（必填）
   - 联系人姓名（必填）
   - 联系电话（必填）
5. 提交申请，等待审核

### 商户类型

| 类型 | 说明 |
|------|------|
| PERSONAL | 个人商户 |
| ENTERPRISE | 企业商户 |

### 商户状态

| 状态 | 说明 |
|------|------|
| PENDING | 待审核 |
| APPROVED | 已通过 |
| REJECTED | 已拒绝 |
| CLOSED | 已关闭 |

### 注册示例

```json
{
  "merchantName": "我的店铺",
  "merchantType": "PERSONAL",
  "contactName": "张三",
  "contactPhone": "13800138000"
}
```

---

## 应用创建

### 创建应用

1. 进入"商户中心" → "应用管理"
2. 点击"创建应用"
3. 填写应用信息：
   - 应用名称（必填）
   - 回调地址（可选）
4. 创建成功，保存 AppID 和 AppSecret

### 应用信息

```json
{
  "id": "uuid",
  "appId": "app_xxxxx",
  "appSecret": "secret_xxxxx",
  "name": "我的应用"
}
```

> 请妥善保管 AppSecret，关闭对话框后将无法再次查看。

### 重新生成密钥

如需重新生成密钥：

1. 进入"应用管理"
2. 找到对应应用
3. 点击"重新生成密钥"
4. 确认操作

> 注意：原密钥立即失效。

---

## API 集成

### 签名算法

所有 API 调用需要 HMAC-SHA256 签名认证。

**签名字符串格式：**
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

### 签名示例

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

### 创建订单

```http
POST /open-api/v1/orders
Content-Type: application/json
X-App-Id: your_app_id
X-Timestamp: 1704067200000
X-Nonce: random_nonce_123
X-Signature: a1b2c3d4e5f6...

{
  "merchantOrderNo": "ORDER_20240101_001",
  "amount": 99.99,
  "subject": "测试商品",
  "body": "商品描述",
  "callbackUrl": "https://your-server.com/callback",
  "expiredAt": "2024-01-02T00:00:00"
}
```

### 查询订单

```http
GET /open-api/v1/orders/:orderNo
X-App-Id: your_app_id
X-Timestamp: 1704067200000
X-Nonce: random_nonce_123
X-Signature: a1b2c3d4e5f6...
```

### 申请退款

```http
POST /open-api/v1/refunds
Content-Type: application/json
X-App-Id: your_app_id
X-Timestamp: 1704067200000
X-Nonce: random_nonce_123
X-Signature: a1b2c3d4e5f6...

{
  "orderNo": "PAY20240101000001",
  "amount": 50.00,
  "reason": "部分退货"
}
```

### 商户转账

```http
POST /open-api/v1/transfers
Content-Type: application/json
X-App-Id: your_app_id
X-Timestamp: 1704067200000
X-Nonce: random_nonce_123
X-Signature: a1b2c3d4e5f6...

{
  "toUserId": "target_user_uuid",
  "amount": 10.00,
  "remark": "商户转账"
}
```

### 查询余额

```http
GET /open-api/v1/balance
X-App-Id: your_app_id
X-Timestamp: 1704067200000
X-Nonce: random_nonce_123
X-Signature: a1b2c3d4e5f6...
```

---

## 订单管理

### 订单状态

| 状态 | 说明 |
|------|------|
| PENDING | 待支付 |
| PAID | 已支付 |
| CLOSED | 已关闭 |
| REFUNDED | 已退款 |

### 订单查询

通过 API 查询订单详情：

```javascript
const order = await kebaipay.orders.get('PAY20240101000001')

console.log(order.status)       // PAID
console.log(order.amountYuan)   // "99.99"
console.log(order.feeYuan)      // "0.60"
```

### 回调通知

订单状态变更时，系统会向回调地址发送通知。

**回调请求头：**

| Header | 说明 |
|--------|------|
| `X-Webhook-Timestamp` | 时间戳 |
| `X-Webhook-Nonce` | 随机字符串 |
| `X-Webhook-Signature` | HMAC-SHA256 签名 |

**回调请求体：**
```json
{
  "orderNo": "PAY20240101000001",
  "merchantOrderNo": "ORDER_001",
  "status": "PAID",
  "amount": 9999,
  "amountYuan": "99.99",
  "paidAt": "2024-01-01T00:05:00.000Z"
}
```

**回调处理要求：**
1. 必须返回 HTTP 200 状态码
2. 必须验证回调签名
3. 建议异步处理业务逻辑

---

## 结算管理

### 结算周期

- T+1 结算
- 每日自动结算前一日已完成的订单

### 结算金额

- 结算金额 = 订单金额 - 手续费
- 手续费 = 订单金额 × 费率

### 费率说明

- 收款费率：在商户入驻时设定
- 提现费率：在商户入驻时设定

### 查看结算

1. 进入"商户中心" → "结算明细"
2. 查看每日结算记录
3. 导出结算报表

### 结算示例

```json
{
  "date": "2024-01-01",
  "orderCount": 10,
  "totalAmount": "1000.00",
  "totalFee": "6.00",
  "settlementAmount": "994.00"
}
```

---

## 常见问题

### Q: 如何获取 AppID 和 AppSecret？

在"商户中心" → "应用管理"创建应用后，系统会显示 AppID 和 AppSecret。请妥善保管 AppSecret。

### Q: AppSecret 泄露了怎么办？

立即在"应用管理"中重新生成密钥，原密钥立即失效。

### Q: 回调地址有什么要求？

- 必须是 http 或 https 协议
- 不允许指向内网地址
- 格式必须有效

### Q: 如何验证回调签名？

详见 [SDK 使用指南](./SDK_GUIDE.md) 中的 Webhook 签名验证章节。

### Q: 费率可以调整吗？

请联系管理员调整费率。

### Q: 结算金额什么时候到账？

T+1 结算，结算后自动打入商户余额。

### Q: 如何查看交易明细？

通过 API 查询订单详情，或在"商户中心"查看交易记录。

### Q: 支持退款吗？

支持全额退款和部分退款。退款金额不能超过可退金额。

### Q: 如何处理重复回调？

系统会自动去重，相同订单的相同状态只会通知一次。

### Q: 如何测试集成？

使用测试 AppID 和 AppSecret 进行测试，测试环境地址：`http://localhost:3000`。
