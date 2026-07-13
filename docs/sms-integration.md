# 短信服务接入指南

本系统支持 4 个短信服务商：阿里云、腾讯云、华为云、mock（仅开发环境）。切换服务商只需修改 `.env` 中的 `SMS_PROVIDER`，无需改代码。

## 通用配置

所有服务商共用的配置：

```bash
# 服务商：aliyun / tencent / huawei / mock
SMS_PROVIDER="tencent"

# 短信签名（需在服务商控制台审核通过）
SMS_SIGN_NAME="科佰支付"

# 短信模板 ID（需在服务商控制台审核通过）
# 模板内容示例：您的验证码是${code}，5分钟内有效，请勿泄露。
SMS_TEMPLATE_CODE="SMS_123456789"
```

> **重要**：模板变量必须为 `${code}`（验证码），系统会自动传入 6 位数字验证码。

---

## 一、腾讯云短信接入

### 1. 前置条件

- 注册腾讯云账号，完成实名认证
- 开通短信服务：https://console.cloud.tencent.com/smsv2

### 2. 获取配置

| 配置项 | 获取位置 |
|--------|----------|
| `SMS_TENCENT_SECRET_ID` | 访问管理 → API 密钥管理 → 新建密钥 |
| `SMS_TENCENT_SECRET_KEY` | 同上（与 SecretId 一起生成） |
| `SMS_TENCENT_SDK_APP_ID` | 短信控制台 → 应用管理 → 短信应用 → SmsSdkAppID（如 `1400006666`） |
| `SMS_SIGN_NAME` | 短信控制台 → 国内/国际短信 → 签名管理 → 签名内容（如 `科佰支付`） |
| `SMS_TEMPLATE_CODE` | 短信控制台 → 正文模板管理 → 模板 ID（如 `123456`） |

### 3. 创建签名和模板

1. **签名**：在控制台创建签名，类型选择"公司"或"网站"，上传营业执照等材料，审核通过后获得签名内容
2. **模板**：创建正文模板，模板内容如 `您的验证码是{1}，{2}分钟内有效`，审核通过后获得模板 ID

> 注意：腾讯云模板变量用 `{1}`、`{2}` 占位，系统按顺序传入验证码

### 4. 配置 .env

```bash
SMS_PROVIDER="tencent"
SMS_SIGN_NAME="科佰支付"
SMS_TEMPLATE_CODE="123456"
SMS_TENCENT_SECRET_ID="AKIDxxxxxxxxxxxxx"
SMS_TENCENT_SECRET_KEY="xxxxxxxxxxxxxxxxxxx"
SMS_TENCENT_SDK_APP_ID="1400006666"
```

### 5. 技术细节

- SDK：`tencentcloud-sdk-nodejs-sms`（已安装，Apache-2.0）
- API 版本：`2021-01-11`（最新稳定版）
- 签名算法：`TC3-HMAC-SHA256`（SDK 内部自动处理）
- 手机号格式：自动转换为 E.164（`+8613800138000`）
- 错误码参考：https://cloud.tencent.com/document/product/382/55981

---

## 二、华为云短信接入

### 1. 前置条件

- 注册华为云账号，完成实名认证
- 开通消息&短信服务：https://console.huaweicloud.com/msgsms/

### 2. 获取配置

| 配置项 | 获取位置 |
|--------|----------|
| `SMS_HUAWEI_APP_ID` | 短信控制台 → 应用管理 → 应用 → AppKey |
| `SMS_HUAWEI_APP_SECRET` | 同上（AppSecret，与应用一起生成） |
| `SMS_HUAWEI_SENDER` | 短信控制台 → 签名管理 → 签名通道号（如 `csms12345678`） |
| `SMS_SIGN_NAME` | 短信控制台 → 签名管理 → 签名内容（如 `科佰支付`） |
| `SMS_TEMPLATE_CODE` | 短信控制台 → 模板管理 → 模板 ID（如 `8ff55eac1d0b478ab3c06c3c6a492300`） |
| `SMS_HUAWEI_ENDPOINT` | 区域端点，默认 `smsapi.cn-north-4.myhuaweicloud.com` |

### 3. 创建签名和模板

1. **签名**：在控制台创建签名，类型选择"企业"或"网站"，上传营业执照，审核通过后获得签名通道号（sender）
2. **模板**：创建短信模板，模板内容如 `您的验证码是${1}，5分钟内有效`，审核通过后获得模板 ID

> 注意：华为云模板变量用 `${1}` 占位，系统传入 `["123456"]` 格式的 JSON 数组

### 4. 配置 .env

```bash
SMS_PROVIDER="huawei"
SMS_SIGN_NAME="科佰支付"
SMS_TEMPLATE_CODE="8ff55eac1d0b478ab3c06c3c6a492300"
SMS_HUAWEI_APP_ID="xxxxxxxxxxxxx"
SMS_HUAWEI_APP_SECRET="xxxxxxxxxxxxxxxxxxx"
SMS_HUAWEI_SENDER="csms12345678"
# 如果用其他区域，同步修改 endpoint
SMS_HUAWEI_ENDPOINT="smsapi.cn-north-4.myhuaweicloud.com"
```

### 5. 技术细节

- 接口：`POST /sms/batchSendSms/v1`（官方推荐，无需安装 SDK）
- 鉴权：`SDK-HMAC-SHA256`（AK/SK 签名，代码内部自动计算）
- Content-Type：`application/x-www-form-urlencoded`
- 手机号格式：自动转换为 E.164
- 签名算法详见：https://support.huaweicloud.com/devg-apisign/api-sign-algorithm.html
- 错误码参考：https://support.huaweicloud.com/api-msgsms/sms_05_0041.html

---

## 三、阿里云短信接入

### 1. 前置条件

- 注册阿里云账号，完成实名认证
- 开通短信服务：https://dysms.console.aliyun.com/

### 2. 获取配置

| 配置项 | 获取位置 |
|--------|----------|
| `SMS_ACCESS_KEY_ID` | RAM 访问控制 → AccessKey 管理 |
| `SMS_ACCESS_KEY_SECRET` | 同上 |
| `SMS_SIGN_NAME` | 短信控制台 → 国内消息 → 签名管理 → 签名名称 |
| `SMS_TEMPLATE_CODE` | 短信控制台 → 国内消息 → 模板管理 → 模板 CODE（如 `SMS_123456789`） |

### 3. 配置 .env

```bash
SMS_PROVIDER="aliyun"
SMS_SIGN_NAME="科佰支付"
SMS_TEMPLATE_CODE="SMS_123456789"
SMS_ACCESS_KEY_ID="LTAIxxxxxxxxx"
SMS_ACCESS_KEY_SECRET="xxxxxxxxxxxxxxxxxx"
```

### 4. 技术细节

- 接口：`SendSms`（直接 HTTP 调用，无需安装 SDK）
- 签名算法：`HMAC-SHA1`（代码内部自动计算）
- 模板变量：`${code}` 格式

---

## 四、Mock 模式（开发环境）

```bash
SMS_PROVIDER="mock"
```

- 不真正发送短信，验证码打印到服务端日志
- 生产环境启动时会自动抛错拒绝启动
- 适合本地开发和 CI 测试

---

## 测试验证

配置完成后，用 curl 测试：

```bash
# 发送验证码
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","scene":"login"}'

# 验证
curl -X POST http://localhost:3000/sms/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","scene":"login","code":"123456"}'
```

成功返回：

```json
{
  "success": true,
  "code": "OK",
  "message": "发送成功",
  "provider": "tencent"
}
```

## 故障排查

| 错误码 | 原因 | 解决方案 |
|--------|------|----------|
| `TENCENT_CONFIG_MISSING` | 腾讯云密钥未配置 | 检查 `SMS_TENCENT_SECRET_ID/SECRET_KEY` |
| `HUAWEI_CONFIG_MISSING` | 华为云密钥未配置 | 检查 `SMS_HUAWEI_APP_ID/APP_SECRET` |
| `isv.BUSINESS_LIMIT_CONTROL` | 腾讯云业务限流 | 同号码 1 分钟 1 条、1 小时 5 条、1 天 10 条 |
| `ECONNREFUSED` | 网络不通 | 检查服务器出网防火墙 |
| `HUAWEI_TIMEOUT` | 华为云请求超时 | 检查 endpoint 区域是否正确 |

## 安全建议

1. **密钥管理**：所有密钥通过环境变量注入，禁止写入代码或提交到 Git
2. **生产环境**：`SMS_PROVIDER` 必须为 `aliyun`/`tencent`/`huawei`，系统会自动拒绝 `mock` 启动
3. **日志脱敏**：系统已对手机号脱敏（`138****1234`），验证码仅 mock 模式打印
4. **频率限制**：系统已内置防轰炸（手机号日限 10 条、IP 日限 30 条、60 秒重发限制）
