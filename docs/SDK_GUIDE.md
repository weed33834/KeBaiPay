# KeBaiPay SDK 使用指南

> Node.js SDK 接入示例（**禁止在浏览器端使用**）

## ⚠️ 安全警告

**appSecret 是商户密钥，一旦泄露可伪造任意 OpenAPI 请求（创建订单、退款、转账、查余额），相当于完全接管商户账户。**

- 本 SDK 仅限商户后端（Node.js）使用
- **禁止**在浏览器端 `<script>` 引入或在客户端代码中持有 appSecret
- 浏览器端如需创建订单，必须通过商户自己的后端代理调用 OpenAPI

### 浏览器端创建订单的正确流程

```
浏览器 ──请求创建订单──> 商户后端 ──SDK 调用 OpenAPI──> KeBaiPay
浏览器 <──返回 cashierUrl── 商户后端 <──返回 cashierUrl── KeBaiPay
浏览器 ──跳转 cashierUrl──> KeBaiPay 收银台
```

1. 浏览器请求商户自己的后端接口（如 `/api/orders`）
2. 商户后端用本 SDK 调用 OpenAPI 创建订单
3. 商户后端把 `cashierUrl` 返回给浏览器
4. 浏览器跳转到 `cashierUrl` 完成支付

---

## 目录

- [安装与初始化](#安装与初始化)
- [API 参考](#api-参考)
- [完整接入示例](#完整接入示例)
- [Webhook 签名验证](#webhook-签名验证)
- [错误处理](#错误处理)
- [环境变量配置](#环境变量配置)

---

## 安装与初始化

SDK 文件位于 `public/sdk/kebaipay.js`，直接拷贝到商户后端项目即可使用，无需 npm 安装。

```javascript
const { KeBaiPay } = require('./path/to/kebaipay.js')

const client = new KeBaiPay({
  appId: process.env.KEBAIPAY_APP_ID,
  appSecret: process.env.KEBAIPAY_APP_SECRET,  // 从环境变量读取，禁止硬编码
  baseUrl: 'https://api.your-domain.com',
  timeout: 30000,       // 可选，默认 30s
  maxRetries: 3,        // 可选，默认 3（仅 5xx 和网络错误重试）
})
```

---

## API 参考

| 方法 | 说明 |
|------|------|
| `client.createOrder(params)` | 创建收款订单，返回 orderNo 和 cashierUrl |
| `client.getOrder(orderNo)` | 查询订单详情 |
| `client.refund(params)` | 申请退款（支持全额和部分） |
| `client.transfer(params)` | 商户转账 |
| `client.getBalance()` | 查询商户余额 |

---

## 完整接入示例

```javascript
const { KeBaiPay } = require('./kebaipay.js')
const express = require('express')

const app = express()
app.use(express.json())

const kebaipay = new KeBaiPay({
  appId: process.env.KEBAIPAY_APP_ID,
  appSecret: process.env.KEBAIPAY_APP_SECRET,
  baseUrl: process.env.KEBAIPAY_BASE_URL || 'http://localhost:3000',
})

// 浏览器端调用此接口创建订单（不要把 appSecret 暴露给浏览器）
app.post('/api/orders', async (req, res) => {
  try {
    const { amount, subject } = req.body

    const order = await kebaipay.createOrder({
      merchantOrderNo: `ORDER_${Date.now()}`,
      amount,
      subject,
      callbackUrl: `https://your-server.com/webhooks/kebaipay`,
    })

    res.json({
      success: true,
      orderNo: order.orderNo,
      cashierUrl: order.cashierUrl,  // 浏览器跳转到此 URL 完成支付
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// 查询订单
app.get('/api/orders/:orderNo', async (req, res) => {
  try {
    const order = await kebaipay.getOrder(req.params.orderNo)
    res.json(order)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 退款
app.post('/api/refunds', async (req, res) => {
  try {
    const refund = await kebaipay.refund({
      orderNo: req.body.orderNo,
      amount: req.body.amount,  // 不传则全额退款
      reason: req.body.reason,
      idempotencyKey: `refund_${req.body.orderNo}_${Date.now()}`,
    })
    res.json(refund)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 商户转账
app.post('/api/transfers', async (req, res) => {
  try {
    const transfer = await kebaipay.transfer({
      toUserId: req.body.toUserId,
      amount: req.body.amount,
      remark: req.body.remark,
      idempotencyKey: `transfer_${Date.now()}`,
    })
    res.json(transfer)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 查询余额
app.get('/api/balance', async (req, res) => {
  try {
    const balance = await kebaipay.getBalance()
    res.json(balance)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(3001, () => {
  console.log('Merchant server running on port 3001')
})
```

---

## Webhook 签名验证

### 手动验证（推荐）

```javascript
const crypto = require('crypto')

function verifyWebhookSignature(payload, headers, appSecret) {
  const timestamp = headers['x-webhook-timestamp']
  const nonce = headers['x-webhook-nonce']
  const signature = headers['x-webhook-signature']

  const signString = `${timestamp}\n${nonce}\n${JSON.stringify(payload)}`
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(signString)
    .digest('hex')

  return signature === expected
}

app.post('/webhooks/kebaipay', async (req, res) => {
  // 1. 验证签名
  if (!verifyWebhookSignature(req.body, req.headers, process.env.KEBAIPAY_APP_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // 2. 处理订单状态
  const { orderNo, status, paidAt } = req.body
  if (status === 'PAID') {
    console.log(`订单 ${orderNo} 已支付，支付时间：${paidAt}`)
    // TODO: 更新数据库、发货等
  }

  // 3. 必须返回 200，否则会触发重试
  res.json({ success: true })
})
```

### Webhook 请求头

| Header | 说明 |
|--------|------|
| `X-Webhook-Timestamp` | 时间戳（毫秒） |
| `X-Webhook-Nonce` | 随机字符串 |
| `X-Webhook-Signature` | HMAC-SHA256 签名 |

### 注意事项

1. 必须返回 HTTP 200 状态码，否则会触发重试
2. 建议异步处理业务逻辑，先返回 200 再处理
3. 签名验证失败应返回 401

---

## 错误处理

SDK 所有方法在失败时会抛出包含错误码的异常：

```javascript
try {
  await client.createOrder({
    merchantOrderNo: 'ORDER_001',
    amount: 99.99,
    subject: '测试商品',
  })
} catch (error) {
  console.log(error.code)     // 如 KB711
  console.log(error.message)  // "金额必须大于 0"
  console.log(error.status)   // 400
}
```

### 错误对象属性

| 属性 | 类型 | 说明 |
|------|------|------|
| code | string | KeBaiPay 错误码（如 KB711） |
| message | string | 错误描述 |
| status | number | HTTP 状态码 |

### 重试策略

SDK 内置指数退避重试（仅对 5xx 和网络错误重试，4xx 业务错误不重试）：
- 默认最大重试 3 次
- 退避：2s, 4s, 8s + 随机抖动
- 可通过 `maxRetries: 0` 关闭重试

---

## 环境变量配置

```bash
# .env（商户后端，禁止前端访问）
KEBAIPAY_APP_ID=your_app_id
KEBAIPAY_APP_SECRET=your_app_secret
KEBAIPAY_BASE_URL=http://localhost:3000
```
