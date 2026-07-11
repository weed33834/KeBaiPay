# 短信验证码平台配置指南

> 本指南帮助商户配置短信验证码平台，支持阿里云、腾讯云、华为云。

---

## 📋 目录

1. [选择短信平台](#选择短信平台)
2. [阿里云配置](#阿里云配置)
3. [腾讯云配置](#腾讯云配置)
4. [华为云配置](#华为云配置)
5. [开发环境配置](#开发环境配置)
6. [常见问题](#常见问题)

---

## 选择短信平台

| 平台 | 价格 | 到达率 | 推荐场景 |
|------|------|--------|----------|
| 阿里云 | 0.045元/条 | 99%+ | 企业级应用 |
| 腾讯云 | 0.04元/条 | 99%+ | 微信生态 |
| 华为云 | 0.045元/条 | 99%+ | 政企客户 |
| Mock模式 | 免费 | - | 开发测试 |

---

## 阿里云配置

### 1. 注册阿里云账号

1. 访问 [阿里云官网](https://www.aliyun.com)
2. 注册并完成实名认证
3. 开通短信服务

### 2. 创建短信签名

1. 登录 [短信服务控制台](https://dysms.console.aliyun.com)
2. 进入 **国内消息** -> **签名管理**
3. 点击 **添加签名**
4. 填写信息：
   - 签名名称：`科佰支付`
   - 适用场景：`验证码`
   - 签名来源：`企事业单位的全称或简称`

### 3. 创建短信模板

1. 进入 **模板管理**
2. 点击 **添加模板**
3. 填写信息：
   - 模板名称：`登录验证码`
   - 模板类型：`验证码`
   - 模板内容：`验证码${code}，您正在登录，有效期5分钟。请勿泄露给他人。`

### 4. 获取AccessKey

1. 登录 [RAM访问控制](https://ram.console.aliyun.com)
2. 创建用户，获取 `AccessKey ID` 和 `AccessKey Secret`
3. 授予用户 `AliyunDysmsFullAccess` 权限

### 5. 配置到系统

编辑 `.env` 文件：

```bash
# 阿里云短信配置
SMS_PROVIDER=aliyun
SMS_ACCESS_KEY_ID=your-access-key-id
SMS_ACCESS_KEY_SECRET=your-access-key-secret
SMS_SIGN_NAME=科佰支付
SMS_TEMPLATE_CODE=SMS_123456
```

---

## 腾讯云配置

### 1. 注册腾讯云账号

1. 访问 [腾讯云官网](https://cloud.tencent.com)
2. 注册并完成实名认证
3. 开通短信服务

### 2. 创建应用

1. 登录 [短信控制台](https://console.cloud.tencent.com/smsv2)
2. 进入 **应用管理** -> **应用列表**
3. 点击 **创建应用**
4. 填写信息：
   - 应用名称：`科佰支付`
   - 应用类型：`自用型`
   - 签名类型：`企业`

### 3. 申请签名

1. 进入 **国内短信** -> **签名管理**
2. 点击 **创建签名**
3. 填写信息：
   - 签名类型：`公司`
   - 签名名称：`科佰支付`
   - 上传营业执照

### 4. 申请模板

1. 进入 **模板管理**
2. 点击 **创建模板**
3. 填写信息：
   - 模板名称：`登录验证码`
   - 模板类型：`验证码`
   - 模板内容：`验证码{1}，您正在登录，有效期5分钟。`

### 5. 获取密钥

1. 登录 [访问管理](https://console.cloud.tencent.com/cam)
2. 进入 **访问密钥** -> **API密钥管理**
3. 创建密钥，获取 `SecretId` 和 `SecretKey`

### 6. 配置到系统

编辑 `.env` 文件：

```bash
# 腾讯云短信配置
SMS_PROVIDER=tencent
SMS_TENCENT_SECRET_ID=your-secret-id
SMS_TENCENT_SECRET_KEY=your-secret-key
SMS_TENCENT_SDK_APP_ID=your-sdk-app-id
SMS_SIGN_NAME=科佰支付
SMS_TEMPLATE_CODE=123456
```

---

## 华为云配置

### 1. 注册华为云账号

1. 访问 [华为云官网](https://www.huaweicloud.com)
2. 注册并完成实名认证
3. 开通短信服务

### 2. 创建应用

1. 登录 [短信控制台](https://console.huaweicloud.com/sms)
2. 进入 **应用管理**
3. 点击 **创建应用**
4. 填写信息：
   - 应用名称：`科佰支付`
   - 应用类型：`行业通知`

### 3. 申请签名

1. 进入 **签名管理**
2. 点击 **添加签名**
3. 填写信息：
   - 签名类型：`公司`
   - 签名名称：`科佰支付`
   - 上传营业执照

### 4. 申请模板

1. 进入 **模板管理**
2. 点击 **添加模板**
3. 填写信息：
   - 模板名称：`登录验证码`
   - 模板类型：`验证码`
   - 模板内容：`验证码${code}，您正在登录，有效期5分钟。`

### 5. 获取密钥

1. 登录 [我的凭证](https://console.huaweicloud.com/iam/)
2. 进入 **访问密钥**
3. 创建密钥，获取 `Access Key` 和 `Secret Key`

### 6. 配置到系统

编辑 `.env` 文件：

```bash
# 华为云短信配置
SMS_PROVIDER=huawei
SMS_HUAWEI_APP_ID=your-app-id
SMS_HUAWEI_APP_SECRET=your-app-secret
SMS_SIGN_NAME=科佰支付
SMS_TEMPLATE_CODE=SMS_123456
```

---

## 开发环境配置

### 使用Mock模式

开发和测试环境可以使用Mock模式，验证码会在控制台显示：

```bash
# .env
SMS_PROVIDER=mock
```

启动服务后，发送验证码时会在终端显示：

```
====================================
📱 短信验证码
手机号: 13900001111
验证码: 123456
场景: login
====================================
```

### 测试验证码API

```bash
# 发送验证码
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "13900001111", "scene": "login"}'

# 验证码校验
curl -X POST http://localhost:3000/sms/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "13900001111", "code": "123456", "scene": "login"}'

# 查看配置状态
curl http://localhost:3000/sms/config
```

---

## 常见问题

### Q1: 验证码收不到？

**检查项：**
1. 手机号是否正确
2. 签名是否审核通过
3. 模板是否审核通过
4. 账户余额是否充足

**解决方案：**
```bash
# 检查配置状态
curl http://localhost:3000/sms/config

# 查看服务器日志
# 应该显示: 短信服务提供商: aliyun
```

### Q2: 验证码延迟？

**可能原因：**
1. 网络延迟
2. 短信平台拥堵
3. 手机运营商延迟

**解决方案：**
- 使用多个短信平台作为备选
- 优化短信模板内容
- 添加重试机制

### Q3: 如何测试验证码？

**方法一：使用Mock模式**
```bash
SMS_PROVIDER=mock
# 验证码会在控制台显示
```

**方法二：使用测试手机号**
部分短信平台支持测试手机号，不会真正发送短信。

### Q4: 生产环境如何配置？

1. 使用真实的短信平台（阿里云/腾讯云/华为云）
2. 配置真实的签名和模板
3. 确保账户余额充足
4. 监控短信发送状态

---

## 技术支持

如有问题，请联系：
- **邮箱**: support@kebaipay.com
- **电话**: 400-xxx-xxxx
- **工作时间**: 周一至周五 9:00-18:00
