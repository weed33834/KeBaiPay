# 科佰支付 - 商户接入指南

> 本指南帮助商户快速接入科佰支付系统，实现网站/APP的支付功能。

---

## 📋 目录

1. [快速开始](#快速开始)
2. [账户注册](#账户注册)
3. [创建应用](#创建应用)
4. [配置支付通道](#配置支付通道)
5. [API接入](#api接入)
6. [网页支付接入](#网页支付接入)
7. [回调配置](#回调配置)
8. [测试指南](#测试指南)
9. [上线检查](#上线检查)
10. [常见问题](#常见问题)

---

## 快速开始

### 前置条件

- 已注册科佰支付账户
- 已完成实名认证
- 拥有合法的商业资质
- 服务器可访问互联网

### 5分钟快速接入

```bash
# 1. 登录商户后台
访问: http://your-domain:3000/#merchantLogin
账号: 您的手机号
密码: 您的登录密码

# 2. 创建应用
进入"我的应用" -> "创建应用"
填写应用名称和域名

# 3. 获取API密钥
在应用详情页获取:
- AppID (应用ID)
- AppSecret (应用密钥)

# 4. 集成SDK
<script src="http://your-domain:3000/sdk/kebaipay.js"></script>

# 5. 发起支付
const sdk = new KeBaiPay({
    appId: 'your-app-id',
    appSecret: 'your-app-secret'
});
```

---

## 账户注册

### 1. 访问注册页面

```
http://your-domain:3000/#register
```

### 2. 填写注册信息

| 字段 | 说明 | 要求 |
|------|------|------|
| 手机号 | 登录账号 | 11位有效手机号 |
| 密码 | 登录密码 | 8位以上，含字母和数字 |
| 昵称 | 显示名称 | 2-32个字符 |

### 3. 完成实名认证

注册后需完成实名认证才能使用支付功能：

```
进入"个人中心" -> "实名认证"
填写:
- 真实姓名
- 身份证号
- 身份证正反面照片
```

---

## 创建应用

### 1. 登录商户后台

```
http://your-domain:3000/#merchantLogin
```

### 2. 创建应用

进入 **我的应用** -> **创建应用**

| 字段 | 说明 | 示例 |
|------|------|------|
| 应用名称 | 您的应用名称 | "我的商城" |
| 应用域名 | 您的网站域名 | "example.com" |
| 应用描述 | 简单描述 | "电商购物平台" |

### 3. 获取API密钥

创建成功后，在应用详情页获取：

```
AppID:      merchant_xxxxxxxxxxxxxxxx
AppSecret:  sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

⚠️ **重要**: AppSecret仅在创建时显示，请妥善保存！

---

## 配置支付通道

### 1. 微信支付配置

#### 1.1 申请微信商户号

1. 访问 [微信支付商户平台](https://pay.weixin.qq.com)
2. 注册商户号
3. 完成商户验证
4. 获取商户号和API密钥

#### 1.2 在科佰支付配置

进入 **管理后台** -> **支付通道** -> **微信支付**

| 配置项 | 说明 | 获取方式 |
|--------|------|----------|
| 商户号 | 微信支付商户号 | 微信商户平台 |
| API密钥 | API密钥 | 微信商户平台 -> API安全 |
| 证书序列号 | 证书序列号 | 微信商户平台 -> API安全 |
| 私钥文件 | 商户私钥 | 本地生成 |
| 平台证书 | 微信平台证书 | API下载 |

#### 1.3 生成证书

```bash
# 生成商户证书
openssl genrsa -out merchant_private_key.pem 2048
openssl req -new -key merchant_private_key.pem -out merchant_csr.pem
# 将CSR提交到微信商户平台，下载证书
```

### 2. 支付宝配置

#### 2.1 申请支付宝开放平台

1. 访问 [支付宝开放平台](https://open.alipay.com)
2. 注册开发者账号
3. 创建应用
4. 获取AppID和密钥

#### 2.2 在科佰支付配置

进入 **管理后台** -> **支付通道** -> **支付宝**

| 配置项 | 说明 | 获取方式 |
|--------|------|----------|
| AppID | 应用ID | 支付宝开放平台 |
| 应用私钥 | RSA2私钥 | 本地生成 |
| 公钥 | 支付宝公钥 | 支付宝开放平台 |

#### 2.3 生成密钥

```bash
# 生成RSA密钥对
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
# 将公钥上传到支付宝开放平台
```

---

## API接入

### 1. 引入SDK

#### 方式一：HTML引入

```html
<script src="http://your-domain:3000/sdk/kebaipay.js"></script>
```

#### 方式二：npm安装

```bash
npm install kebaipay-sdk
```

```javascript
const KeBaiPay = require('kebaipay-sdk');
```

### 2. 初始化SDK

```javascript
const sdk = new KeBaiPay({
    appId: 'merchant_xxxxxxxxxxxxxxxx',
    appSecret: 'sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'http://your-domain:3000'
});
```

### 3. 发起支付

```javascript
// 创建订单
const order = await sdk.createOrder({
    merchantOrderNo: 'ORDER_' + Date.now(),
    amount: 100,  // 金额（分）
    subject: '商品购买',
    body: '购买VIP会员',
    notifyUrl: 'https://your-domain.com/payment/notify'
});

if (order.success) {
    // 跳转到支付页面
    window.location.href = order.data.payUrl;
} else {
    alert('创建订单失败: ' + order.message);
}
```

### 4. 查询订单

```javascript
const result = await sdk.getOrder(orderNo);
console.log('订单状态:', result.data.status);
```

### 5. 申请退款

```javascript
const refund = await sdk.refund({
    orderNo: orderNo,
    amount: 100,  // 退款金额（分）
    reason: '用户申请退款'
});
```

---

## 回调配置

### 1. 配置回调URL

在创建应用时设置回调URL，或在应用设置中修改。

### 2. 回调格式

```json
{
    "orderNo": "KB20240101120000001",
    "merchantOrderNo": "ORDER_123456",
    "status": "PAID",
    "amount": 100,
    "fee": 6,
    "paidAt": "2024-01-01T12:00:00Z",
    "signature": "xxxxx"
}
```

### 3. 验证签名

```javascript
const isValid = sdk.verifyCallback(callbackData, signature);
if (isValid) {
    // 处理回调
    // 更新订单状态
    // 返回成功
}
```

### 4. 回调响应

```json
{
    "code": 0,
    "message": "success"
}
```

---

## 测试指南

### 1. 测试环境

```
测试地址: http://your-domain:3000
测试账号: 请联系管理员创建
测试密码: 需要管理员设置
```

### 2. 测试流程

1. **创建测试订单**
   ```javascript
   const testOrder = await sdk.createOrder({
       merchantOrderNo: 'TEST_' + Date.now(),
       amount: 1,  // 1分钱
       subject: '测试商品'
   });
   ```

2. **模拟支付**
   - 在测试环境中，支付会自动成功
   - 检查回调是否收到

3. **验证结果**
   ```javascript
   const order = await sdk.getOrder(testOrder.data.orderNo);
   console.log('订单状态:', order.data.status);
   // 应该显示: PAID
   ```

### 3. 测试用例

| 场景 | 预期结果 |
|------|----------|
| 正常支付 | 订单状态变为PAID |
| 重复支付 | 返回错误 |
| 超时未支付 | 订单自动关闭 |
| 退款 | 订单状态变为REFUNDED |

---

## 上线检查

### ✅ 上线前检查清单

- [ ] 已完成实名认证
- [ ] 已配置真实支付通道
- [ ] 已测试支付流程
- [ ] 已配置回调URL
- [ ] 已验证签名功能
- [ ] 已配置HTTPS
- [ ] 已设置错误监控
- [ ] 已备份API密钥

### 🔒 安全检查

- [ ] AppSecret已安全存储
- [ ] API密钥未泄露到代码仓库
- [ ] 回调URL使用HTTPS
- [ ] 已配置IP白名单（推荐）
- [ ] 已开启异常告警

### 📊 监控配置

- [ ] 订单状态监控
- [ ] 支付成功率监控
- [ ] 异常日志监控
- [ ] 服务器性能监控

---

## 常见问题

### Q1: 支付回调没收到？

**检查项：**
1. 回调URL是否正确
2. 服务器是否可访问
3. 是否配置了HTTPS
4. 服务器防火墙是否开放

**解决方案：**
```bash
# 测试回调URL是否可访问
curl -X POST https://your-domain.com/payment/notify \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Q2: 签名验证失败？

**检查项：**
1. AppSecret是否正确
2. 时间戳是否在5分钟内
3. 签名算法是否正确

**解决方案：**
```javascript
// 确保使用正确的密钥
const sdk = new KeBaiPay({
    appId: 'your-app-id',
    appSecret: 'your-correct-app-secret'  // 检查这个值
});
```

### Q3: 订单状态一直是PENDING？

**可能原因：**
1. 回调未处理
2. 支付通道配置错误
3. 网络问题

**解决方案：**
```javascript
// 主动查询订单状态
const order = await sdk.getOrder(orderNo);
if (order.data.status === 'PENDING') {
    // 等待10秒后重试
    setTimeout(() => sdk.getOrder(orderNo), 10000);
}
```

### Q4: 如何切换测试/生产环境？

```javascript
// 测试环境
const testSdk = new KeBaiPay({
    appId: 'test_xxx',
    baseUrl: 'http://localhost:3000'
});

// 生产环境
const prodSdk = new KeBaiPay({
    appId: 'merchant_xxx',
    baseUrl: 'https://pay.your-domain.com'
});
```

### Q5: 支付金额单位是什么？

金额单位为 **分**（人民币）。
- 1元 = 100分
- 10元 = 1000分
- 100元 = 10000分

---

## 技术支持

- **文档**: http://your-domain:3000/api/docs
- **邮箱**: support@kebaipay.com
- **电话**: 400-xxx-xxxx
- **工作时间**: 周一至周五 9:00-18:00

---

## 更新日志

### v1.0.0 (2024-01-01)
- 初始版本发布
- 支持微信支付、支付宝
- 支持网页支付、扫码支付
- 支持退款功能
- 支持回调通知
