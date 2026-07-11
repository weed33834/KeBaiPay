# KeBaiPay SDK 使用指南

> JavaScript/Node.js SDK 接入示例

## 目录

- [SDK API 参考](#sdk-api-参考)
- [JavaScript SDK（浏览器端）](#javascript-sdk浏览器端)
- [Node.js SDK（服务端）](#nodejs-sdkservice端)
- [Webhook 签名验证](#webhook-签名验证)
- [错误处理](#错误处理)
- [完整示例](#完整示例)
- [环境变量配置](#环境变量配置)

---

## SDK API 参考

### 客户端初始化

```javascript
const KeBaiPay = require('kebaipay-sdk')

const client = new KeBaiPay({
  appId: 'your_app_id',
  appSecret: 'your_app_secret',
  baseUrl: 'https://api.your-domain.com',
})
```

### 方法列表

| 模块 | 方法 | 说明 |
|------|------|------|
| `client.orders.create(data)` | 创建收款订单 | 返回 orderNo 和 cashierUrl |
| `client.orders.get(orderNo)` | 查询订单详情 | 返回订单状态和金额 |
| `client.refunds.create(data)` | 申请退款 | 支持全额和部分退款 |
| `client.transfers.create(data)` | 商户转账 | 向用户转账 |
| `client.balance.get()` | 查询余额 | 返回可用/冻结/总额 |
| `client.webhooks.verify(body, headers)` | 验证回调签名 | 返回 boolean |

---

## JavaScript SDK（浏览器端）

### 安装

```bash
npm install kebaipay-sdk
```

或通过 CDN 引入：

```html
<script src="https://unpkg.com/kebaipay-sdk/dist/kebaipay.min.js"></script>
```

### 初始化

```javascript
import KeBaiPay from 'kebaipay-sdk'

const client = new KeBaiPay({
  appId: 'your_app_id',
  appSecret: 'your_app_secret',
  baseUrl: 'https://api.your-domain.com',
})
```

### 创建收款订单

```javascript
const order = await client.orders.create({
  merchantOrderNo: 'ORDER_20240101_001',
  amount: 99.99,
  subject: '测试商品',
  body: '商品描述',
  callbackUrl: 'https://your-server.com/callback',
  expiredAt: '2024-01-02T00:00:00',
})

console.log(order.orderNo)      // PAY20240101000001
console.log(order.cashierUrl)   // 收银台链接
```

### 查询订单

```javascript
const order = await client.orders.get('PAY20240101000001')

console.log(order.status)       // PAID
console.log(order.amountYuan)   // "99.99"
```

### 申请退款

```javascript
// 全额退款
const refund = await client.refunds.create({
  orderNo: 'PAY20240101000001',
  reason: '用户申请退款',
})

// 部分退款
const partialRefund = await client.refunds.create({
  orderNo: 'PAY20240101000001',
  amount: 50.00,
  reason: '部分退货',
})
```

### 商户转账

```javascript
const transfer = await client.transfers.create({
  toUserId: 'target_user_uuid',
  amount: 10.00,
  remark: '商户转账',
})
```

### 查询余额

```javascript
const balance = await client.balance.get()

console.log(balance.availableYuan)  // "1000.00"
console.log(balance.frozenYuan)     // "0.00"
console.log(balance.totalYuan)      // "1000.00"
```

---

## Node.js SDK（服务端）

### 安装

```bash
npm install kebaipay-sdk
```

### 初始化

```javascript
const KeBaiPay = require('kebaipay-sdk')

const client = new KeBaiPay({
  appId: process.env.KEBAIPAY_APP_ID,
  appSecret: process.env.KEBAIPAY_APP_SECRET,
  baseUrl: process.env.KEBAIPAY_BASE_URL || 'http://localhost:3000',
})
```

### 完整接入示例

```javascript
const KeBaiPay = require('kebaipay-sdk')
const express = require('express')

const app = express()
app.use(express.json())

const kebaipay = new KeBaiPay({
  appId: process.env.KEBAIPAY_APP_ID,
  appSecret: process.env.KEBAIPAY_APP_SECRET,
  baseUrl: 'http://localhost:3000',
})

// 创建订单接口
app.post('/api/orders', async (req, res) => {
  try {
    const { amount, subject } = req.body

    const order = await kebaipay.orders.create({
      merchantOrderNo: `ORDER_${Date.now()}`,
      amount,
      subject,
      callbackUrl: `https://your-server.com/webhooks/kebaipay`,
    })

    res.json({
      success: true,
      orderNo: order.orderNo,
      cashierUrl: order.cashierUrl,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// 回调通知处理
app.post('/webhooks/kebaipay', async (req, res) => {
  const { orderNo, status, paidAt } = req.body

  // 验证签名
  const isValid = kebaipay.webhooks.verify(req.body, req.headers)
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  // 处理订单状态
  if (status === 'PAID') {
    // 订单已支付，更新业务状态
    console.log(`订单 ${orderNo} 已支付，支付时间：${paidAt}`)
    // TODO: 更新数据库、发货等
  }

  // 必须返回 200，否则会触发重试
  res.json({ success: true })
})

app.listen(3001, () => {
  console.log('Server running on port 3001')
})
```

---

## Webhook 签名验证

### SDK 内置验证

```javascript
const isValid = kebaipay.webhooks.verify(req.body, req.headers)
if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' })
}
```

### 手动验证

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
  await client.orders.create({
    merchantOrderNo: 'ORDER_001',
    amount: 99.99,
    subject: '测试商品',
  })
} catch (error) {
  console.log(error.code)     // KB711
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

### 常见错误码

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| KB401 | 签名失败 | 检查 appSecret 和签名算法 |
| KB717 | 应用已禁用 | 联系管理员启用应用 |
| KB711 | 金额无效 | 检查金额是否 > 0 |
| KB713 | 订单不可退 | 检查订单状态 |
| KB714 | 订单已全额退款 | 检查退款记录 |
| KB715 | 退款金额无效 | 检查退款金额 |
| KB716 | 退款金额超过可退金额 | 查询订单可退金额 |
| KB005 | 余额不足 | 确保账户余额充足 |
| KB601 | 商户订单号已存在 | 使用唯一的订单号 |
| KB712 | 过期时间超过 24 小时 | 调整过期时间 |

### 重试策略

对于网络错误（如超时），建议使用指数退避重试：

```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (error.status >= 500 && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000))
        continue
      }
      throw error
    }
  }
}
```

---

## 完整示例

### 1. 电商支付场景

```javascript
const KeBaiPay = require('kebaipay-sdk')

const kebaipay = new KeBaiPay({
  appId: 'app_xxx',
  appSecret: 'secret_xxx',
  baseUrl: 'https://api.kebaipay.com',
})

async function createPaymentForOrder(orderId, amount, subject) {
  // 1. 创建 KeBaiPay 订单
  const kbOrder = await kebaipay.orders.create({
    merchantOrderNo: orderId,
    amount,
    subject,
    callbackUrl: `https://shop.example.com/api/kebaipay/callback`,
  })

  // 2. 返回收银台链接给前端
  return {
    orderNo: kbOrder.orderNo,
    payUrl: kbOrder.cashierUrl,
  }
}

async function handlePaymentCallback(payload) {
  // 1. 验证签名
  // 2. 检查订单状态
  if (payload.status === 'PAID') {
    // 3. 更新订单状态
    await db.orders.update({
      where: { id: payload.merchantOrderNo },
      data: { status: 'PAID', paidAt: payload.paidAt },
    })

    // 4. 触发后续流程（发货、通知用户等）
    await triggerShipping(payload.merchantOrderNo)
  }

  return { success: true }
}
```

### 2. 余额查询与转账

```javascript
// 查询商户余额
const balance = await kebaipay.balance.get()
console.log(`可用余额：${balance.availableYuan} 元`)

// 向用户转账
if (parseFloat(balance.availableYuan) >= 10.00) {
  const transfer = await kebaipay.transfers.create({
    toUserId: 'user_uuid',
    amount: 10.00,
    remark: '佣金结算',
    idempotencyKey: `commission_${Date.now()}`,
  })
  console.log('转账成功：', transfer)
}
```

### 3. 退款处理

```javascript
async function processRefund(orderNo, refundAmount, reason) {
  try {
    const refund = await kebaipay.refunds.create({
      orderNo,
      amount: refundAmount,
      reason,
      idempotencyKey: `refund_${orderNo}_${Date.now()}`,
    })

    console.log('退款成功：', refund)
    return refund
  } catch (error) {
    if (error.code === 'KB714') {
      console.log('订单已全额退款')
    } else if (error.code === 'KB716') {
      console.log('退款金额超过可退金额')
    }
    throw error
  }
}
```

### 4. 批量查询订单状态

```javascript
async function batchCheckOrders(orderNos) {
  const results = await Promise.allSettled(
    orderNos.map(orderNo => kebaipay.orders.get(orderNo))
  )

  return results.map((result, index) => ({
    orderNo: orderNos[index],
    status: result.status === 'fulfilled' ? result.value.status : 'ERROR',
    error: result.status === 'rejected' ? result.reason.message : null,
  }))
}
```

### 5. 定时任务：检查过期订单

```javascript
const cron = require('node-cron')

cron.schedule('*/5 * * * *', async () => {
  try {
    // 查询所有待支付订单
    const pendingOrders = await db.orders.findMany({
      where: { status: 'PENDING' }
    })

    for (const order of pendingOrders) {
      const kbOrder = await kebaipay.orders.get(order.orderNo)
      if (kbOrder.status === 'CLOSED') {
        // 订单已过期，更新本地状态
        await db.orders.update({
          where: { id: order.id },
          data: { status: 'EXPIRED' }
        })
      }
    }
  } catch (error) {
    console.error('定时任务执行失败：', error)
  }
})
```

---

## 环境变量配置

```bash
# .env
KEBAIPAY_APP_ID=your_app_id
KEBAIPAY_APP_SECRET=your_app_secret
KEBAIPAY_BASE_URL=http://localhost:3000
```

---

## TypeScript 支持

SDK 提供完整的 TypeScript 类型定义：

```typescript
import KeBaiPay, { Order, Refund, Balance } from 'kebaipay-sdk'

const client = new KeBaiPay({
  appId: process.env.KEBAIPAY_APP_ID!,
  appSecret: process.env.KEBAIPAY_APP_SECRET!,
  baseUrl: process.env.KEBAIPAY_BASE_URL!,
})

async function createOrder(): Promise<Order> {
  return client.orders.create({
    merchantOrderNo: `ORDER_${Date.now()}`,
    amount: 99.99,
    subject: '测试商品',
  })
}
```
