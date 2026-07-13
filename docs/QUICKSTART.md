# 科佰支付 - 快速接入指南

> 5分钟完成支付接入！

---

## 🚀 快速开始

### 第一步：注册账号

```
访问: http://your-domain:3000/#register
填写: 手机号 + 密码
完成: 实名认证
```

### 第二步：创建应用

```
登录商户后台: http://your-domain:3000/#merchantLogin
进入: 我的应用 -> 创建应用
填写: 应用名称 + 域名
获取: AppID 和 AppSecret
```

### 第三步：集成代码

> ⚠️ **安全警告**：appSecret 是商户密钥，**禁止在浏览器端使用**。以下仅展示商户后端（Node.js）接入方式。

#### Node.js 方式（推荐，商户后端）

```javascript
const { KeBaiPay } = require('./path/to/kebaipay.js');
const express = require('express');
const app = express();
app.use(express.json());

const sdk = new KeBaiPay({
    appId: process.env.KEBAIPAY_APP_ID,
    appSecret: process.env.KEBAIPAY_APP_SECRET,  // 从环境变量读取，禁止硬编码
    baseUrl: 'http://your-domain:3000'
});

// 浏览器端调用此接口创建订单（不要把 appSecret 暴露给浏览器）
app.post('/create-order', async (req, res) => {
    const order = await sdk.createOrder({
        merchantOrderNo: 'ORDER_' + Date.now(),
        amount: req.body.amount,
        subject: req.body.subject,
        callbackUrl: 'https://your-domain.com/payment/notify'
    });

    res.json({
        success: true,
        cashierUrl: order.cashierUrl  // 浏览器跳转到此 URL 完成支付
    });
});

// 接收回调
app.post('/payment/notify', (req, res) => {
    const { orderNo, status } = req.body;
    // 验证签名（参见 SDK_GUIDE.md 的 Webhook 签名验证章节）
    if (status === 'PAID') {
        console.log('订单支付成功:', orderNo);
        res.json({ code: 0, message: 'success' });
    } else {
        res.json({ code: -1, message: '未支付' });
    }
});
```

#### 浏览器端流程（通过商户后端代理）

```
浏览器 ──POST /create-order──> 商户后端 ──SDK──> KeBaiPay
浏览器 <──返回 cashierUrl─── 商户后端 <──返回─── KeBaiPay
浏览器 ──跳转 cashierUrl──> KeBaiPay 收银台完成支付
```

### 第四步：测试支付

```javascript
// 测试订单（1分钱）
const testOrder = await sdk.createOrder({
    merchantOrderNo: 'TEST_' + Date.now(),
    amount: 1,
    subject: '测试商品'
});

// 检查结果
const result = await sdk.getOrder(testOrder.data.orderNo);
console.log('订单状态:', result.data.status);
```

### 第五步：上线

1. 配置真实支付通道（微信/支付宝）
2. 部署到生产服务器
3. 配置HTTPS
4. 监控订单状态

---

## 📝 API参考

### 创建订单

```javascript
const order = await sdk.createOrder({
    merchantOrderNo: 'ORDER_123',  // 商户订单号（唯一）
    amount: 100,                    // 金额（分）
    subject: '商品名称',            // 订单标题
    body: '商品描述',               // 订单描述（可选）
    notifyUrl: 'https://...'       // 回调地址（可选）
});
```

### 查询订单

```javascript
const order = await sdk.getOrder(orderNo);
// order.data.status: PENDING | PAID | REFUNDED | CLOSED
```

### 申请退款

```javascript
const refund = await sdk.refund({
    orderNo: orderNo,
    amount: 100,        // 退款金额（分）
    reason: '退款原因'
});
```

### 查询余额

```javascript
const balance = await sdk.getBalance();
console.log('可用余额:', balance.data.available);
```

---

## 🔧 配置说明

### SDK配置项

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| appId | String | 是 | 应用ID |
| appSecret | String | 是 | 应用密钥 |
| baseUrl | String | 否 | API地址，默认当前域名 |
| timeout | Number | 否 | 超时时间（毫秒），默认30000 |

### 订单参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| merchantOrderNo | String | 是 | 商户订单号，唯一 |
| amount | Number | 是 | 金额，单位：分 |
| subject | String | 是 | 订单标题 |
| body | String | 否 | 订单描述 |
| notifyUrl | String | 否 | 回调地址 |

---

## ⚠️ 注意事项

1. **金额单位是分**：1元 = 100分
2. **订单号唯一**：同一商户号下订单号不能重复
3. **签名验证**：回调必须验证签名
4. **HTTPS**：生产环境必须使用HTTPS
5. **超时处理**：建议设置30秒超时

---

## 🆘 获取帮助

- **API文档**: http://your-domain:3000/api/docs
- **技术支持**: support@kebaipay.com
- **工作时间**: 周一至周五 9:00-18:00
