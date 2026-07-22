# KeBaiPay 故障排查手册

> 本手册覆盖 KeBaiPay v2.0.0 在部署、认证、资金操作、商户接入、对账、风控等环节的高频问题。
> 所有命令均假设当前目录为项目根目录（`/workspace/KeBaiPay` 或部署目录）。

## 目录

- [1. 部署排错](#1-部署排错)
- [2. 认证与登录排错](#2-认证与登录排错)
- [3. 资金操作排错](#3-资金操作排错)
- [4. 商户开放 API 排错](#4-商户开放-api-排错)
- [5. 静态资源 404](#5-静态资源-404)
- [6. Swagger 文档打不开](#6-swagger-文档打不开)
- [7. 微信/支付宝回调失败](#7-微信支付宝回调失败)
- [8. 多平台对账（S5）排错](#8-多平台对账s5排错)
- [9. AI 风控审计（S3）排错](#9-ai-风控审计s3排错)
- [10. 性能问题](#10-性能问题)
- [11. 日志查看](#11-日志查看)
- [12. 紧急联系](#12-紧急联系)

---

## 1. 部署排错

### 1.1 SecurityValidator 拒绝启动

**错误信息示例：**

```text
[Nest] LOG [SecurityValidatorService] 生产环境必须配置 CORS_ORIGINS（不允许回退到 localhost）
[Nest] ERROR [SecurityValidatorService] JWT_USER_SECRET 使用了默认值，生产环境必须修改
[Nest] ERROR [SecurityValidatorService] ENCRYPTION_KEY 长度不足 32 位，生产环境不安全
Error: 生产环境安全校验失败，请修复以下问题后重启：
  - JWT_USER_SECRET 使用了默认值，生产环境必须修改
  - ENCRYPTION_KEY 长度不足 32 位，生产环境不安全
```

**原因：** 应用启动时 `SecurityValidatorService.validate()` 会扫描所有敏感配置，生产环境（`NODE_ENV=production`）使用默认值、长度不足或缺失时直接抛错退出，避免带病上线。

**6 个必填 secret 列表（docker-compose.yml 强制要求）：**

| 序号 | 变量名 | 最小长度 | 说明 |
|---|---|---|---|
| 1 | `JWT_USER_SECRET` | 32 | 用户端 JWT 签名密钥 |
| 2 | `JWT_ADMIN_SECRET` | 32 | 管理端 JWT 签名密钥，必须与 `JWT_USER_SECRET` 不同 |
| 3 | `ADMIN_DEFAULT_PASSWORD` | 8（且含大小写+数字） | 初始超管密码，首次登录强制修改 |
| 4 | `ENCRYPTION_KEY` | 32 | AES-256-GCM 加密密钥（身份证 / 银行卡号 / 卡号 hash） |
| 5 | `REDIS_PASSWORD` | — | Redis 鉴权密码，docker-compose 中默认 `redis`，生产必须改 |
| 6 | `POSTGRES_PASSWORD` | — | PostgreSQL 超级用户密码，docker-compose 用 `?` 强制必填 |

**解决步骤：**

1. 复制模板：`cp .env.example .env`
2. 用强随机值替换所有默认密钥：

   ```bash
   # 生成 32 位以上的随机串
   openssl rand -base64 48
   # 或
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. 确认 `JWT_USER_SECRET` 与 `JWT_ADMIN_SECRET` 不相同。
4. 确认 `ADMIN_DEFAULT_PASSWORD` 同时包含大写字母、小写字母、数字，长度 ≥ 8。
5. 重启应用：`docker compose restart app` 或 `pm2 restart kebaipay`。

---

### 1.2 `CORS_ORIGINS is not configured in production`

**原因：** 生产环境下 `SecurityValidatorService` 会强制要求 `CORS_ORIGINS` 已配置且不允许回退到 `localhost`，未配置时启动直接失败。

**解决：**

1. 在 `.env` 中显式配置允许的前端来源（多个用逗号分隔）：

   ```bash
   CORS_ORIGINS=https://admin.kebaipay.com,https://m.kebaipay.com
   ```

2. 生产域名必须使用 `https://`，禁止包含 `localhost` 或 `127.0.0.1`。
3. 若为灰度环境需临时使用 IP，可写 `https://10.0.0.5`，但务必加入告警名单跟踪回收。

---

### 1.3 Prisma 连不上数据库

**错误信息：**

```text
PrismaClientInitializationError: P1001: Can't reach database server at postgres:5432
```

**排查步骤：**

1. **检查容器状态：**

   ```bash
   docker compose ps
   # postgres 应为 Up (healthy)，否则查看日志：
   docker compose logs postgres
   ```

2. **使用 pg_isready 验证连通性：**

   ```bash
   docker compose exec postgres pg_isready -U postgres -d kebaipay
   # 期望输出：/var/run/postgresql:5432 - accepting connections
   ```

3. **核对密码一致性：** `docker-compose.yml` 中 `DATABASE_URL` 直接拼了 `${POSTGRES_PASSWORD}`，若 `.env` 与启动时环境不一致会导致鉴权失败：

   ```bash
   docker compose exec postgres psql -U postgres -d kebaipay -c "SELECT 1;"
   # 若提示 password authentication failed，说明 POSTGRES_PASSWORD 不一致
   ```

   > ⚠️ 首次初始化后修改 `POSTGRES_PASSWORD` 不会同步到已存在的数据卷。需要清空卷重建：
   > `docker compose down -v && docker compose up -d`

4. **网络隔离检查：** `postgres` 与 `redis` 仅在 `db-internal` 网络中，确保 `app` 容器在同一网络。

---

### 1.4 Prisma 迁移失败

**错误信息：**

```text
P3009: migration failed with errors code "P3009"
```

**排查步骤：**

1. **检查 migration 目录：**

   ```bash
   ls prisma/migrations/
   # 每个子目录应包含 migration.sql 与 migration_lock.toml
   ```

2. **查看失败原因：**

   ```bash
   npx prisma migrate status
   ```

3. **重置方案（仅开发环境！生产环境禁止）：**

   ```bash
   # 开发环境：销毁重建
   npx prisma migrate reset --force

   # 生产环境：手工修复
   # 1) 备份数据库
   docker compose exec postgres pg_dump -U postgres kebaipay > backup.sql
   # 2) 标记失败的迁移为已应用（解决 P3009 残留）
   npx prisma migrate resolve --applied <migration_name>
   # 3) 继续应用后续迁移
   npx prisma migrate deploy
   ```

4. **生产环境首次部署：** 必须使用 `npx prisma migrate deploy`，不要使用 `db:push` 或 `migrate dev`。

---

### 1.5 端口 3000 被占用

**错误信息：**

```text
Error: listen EADDRINUSE: address already in use :::3000
```

**原因：** 宿主机的 3000 端口已被占用，或上一轮容器未正常退出。

**解决：**

1. **查端口占用：**

   ```bash
   # 宿主机
   lsof -i :3000
   # 或
   ss -lntp | grep :3000
   ```

2. **改 docker-compose.yml 端口映射**（推荐）：

   ```yaml
   app:
     ports:
       - '8080:3000'   # 宿主机 8080 -> 容器 3000
   ```

3. **或停止占用进程：**

   ```bash
   docker compose down            # 停掉本应用的所有容器
   npx kill-port 3000             # 停掉本机 Node 进程
   ```

---

### 1.6 `docker-compose POSTGRES_PASSWORD must be set`

**错误信息：**

```text
POSTGRES_PASSWORD must be set in .env
```

**原因：** `docker-compose.yml` 中显式声明 `${POSTGRES_PASSWORD:?...}`，表示该变量必须存在，否则 compose 拒绝启动。`.env` 文件缺失或未配置此项即报错。

**解决：**

1. 确认项目根目录存在 `.env` 文件（不是 `.env.example`）：

   ```bash
   ls -la .env
   ```

2. 在 `.env` 中加入：

   ```bash
   POSTGRES_PASSWORD=<强随机密码>
   ```

3. 重新启动：`docker compose up -d`。

4. 同步检查其他 4 个必填变量：`JWT_USER_SECRET`、`JWT_ADMIN_SECRET`、`ADMIN_DEFAULT_PASSWORD`、`ENCRYPTION_KEY`。

---

### 1.7 拉镜像超慢（国内）

**现象：** `docker compose pull` 卡在 `postgres:16-alpine` 或 `redis:7-alpine`，长时间无进度。

**解决：** 配置 Docker 镜像加速源 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://docker.nju.edu.cn",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
```

应用配置：

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | grep -A5 "Registry Mirrors"
```

如果仍慢，可手动 `docker pull` 并打 tag，或使用内网私有镜像仓库。

---

## 2. 认证与登录排错

### 2.1 管理员登录密码错误

**原因：** 忘记管理员密码，或 `ADMIN_DEFAULT_PASSWORD` 与数据库中已修改后的密码不一致。

**解决：** 直接进数据库改密码（生成新的 bcrypt hash）：

```bash
# 进入容器生成 hash
docker compose exec app node -e "console.log(require('bcryptjs').hashSync('NewStrongPwd2026', 10))"

# 进入数据库更新
docker compose exec postgres psql -U postgres -d kebaipay -c \
  "UPDATE \"AdminUser\" SET \"passwordHash\" = '\$2b\$10\$xxxxx替换为上面输出的hash' WHERE username = 'admin';"
```

修改后用新密码登录即可，无需重启服务。

---

### 2.2 用户登录 429

**现象：** 用户连续输错几次密码后所有登录请求返回 `429 Too Many Requests`。

**原因：** `AuthController` 启用了登录限流（`@Throttle`），暴力破解会被锁定。

**解决：**

1. **等待解锁：** 默认窗口 60s 后自动恢复。
2. **清 Redis 计数（紧急）：**

   ```bash
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD"
   # 找到限流 key（默认前缀）
   KEYS *auth*login*
   DEL <key>
   ```

3. **联系用户确认是否本人操作**，必要时人工核验身份后重置密码。

---

### 2.3 登录后立即被踢回

**现象：** 输入账号密码登录成功，但下一次请求立即返回 401。

**原因：** `JWT_USER_SECRET` 或 `JWT_ADMIN_SECRET` 在运行中被修改，旧 token 全部失效。

**解决：**

1. 让用户重新登录获取新 token。
2. 如不需要全员下线，请勿在运行中轮换 JWT 密钥；密钥轮换应走灰度方案（双密钥并存期）。

---

### 2.4 支付密码锁定

**现象：** 用户输入支付密码连续 5 次错误，账号支付功能被冻结。

**原因：** 支付密码错误次数累计达 5 次后，账号会被锁定 15 分钟。

**解决：**

1. 等待 15 分钟自动解锁。
2. 紧急情况可由管理员在后台「用户管理」手动重置支付密码错误计数。
3. 若用户确实忘记支付密码，可通过「安全中心」走实名信息验证流程重置。

---

## 3. 资金操作排错

### 3.1 `Failed to acquire lock within timeout`

**错误信息：**

```text
KBxxx: Failed to acquire lock within timeout
```

**原因：** 资金操作（转账 / 提现 / 充值）使用 Redis 分布式锁，前一次操作异常退出未释放锁，新请求等待超时。

**解决：**

1. **重启 Redis 清掉所有锁 key（最快）：**

   ```bash
   docker compose restart redis
   ```

2. **精确清理（保留其他缓存）：**

   ```bash
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD"
   KEYS lock:*
   DEL lock:transfer:*
   DEL lock:withdraw:*
   ```

3. **排查根因：** 查看 `app` 容器日志，确认上一次操作是否因 OOM、DB 死锁或代码异常未走 finally 释放锁。

---

### 3.2 转账/提现报「余额不足」

**原因：**

1. 真没钱：用户实际可用余额低于操作金额（含手续费）。
2. 上次操作未刷新：前端缓存了旧余额，或上一次操作已完成但 UI 未重新拉取。

**解决：**

1. 后端直接确认：

   ```bash
   docker compose exec postgres psql -U postgres -d kebaipay -c \
     "SELECT id, \"availableBalance\", \"frozenBalance\" FROM \"Account\" WHERE \"userId\" = '<uid>';"
   ```

2. 前端在每次转账/提现后强制刷新账户接口 `/accounts/me`。
3. 若可用余额 + 冻结余额与流水对不上，触发财务对账流程（参见 `docs/PROJECT_PLAN.md` 财务总账部分）。

---

### 3.3 幂等键冲突

**错误信息：**

```text
P2002: Unique constraint failed on the fields: (idempotencyKey)
```

**原因：** 同一个 `idempotencyKey` 被重复用于两次不同的资金请求。所有充值、转账、提现、批量转账、订阅扣款接口都基于 `idempotencyKey @unique` 防重。

**解决：**

1. **不要复用同一个 key**：每次新业务请求生成新的 UUID：

   ```javascript
   import { randomUUID } from 'crypto'
   const idempotencyKey = randomUUID()
   ```

2. **客户端重试场景**：保留上一次的 key 重试，服务端会返回原结果而不是新扣款。
3. **若需要重新发起**：必须使用新的 `idempotencyKey`，前一笔订单走原退款流程。

---

## 4. 商户开放 API 排错

### 4.1 签名失败

**现象：** 商户调用开放 API 返回 `KB7xx: signature mismatch`。

**排查：**

1. **签名串拼接顺序：** 必须按参数 key 字典序升序拼接 `key1=value1&key2=value2...`，最后追加 `&key=APPSECRET`，整体 HMAC-SHA256 后转 hex / base64。
2. **时间戳窗口 120s：** 服务端校验请求时间戳与服务器时间差不超过 120s。商户服务器 NTP 漂移会失败：

   ```bash
   # 商户服务器执行
   ntpdate -q ntp.aliyun.com
   ```

3. **nonce 重复：** 同一 nonce 在 Redis 防重放窗口内只能用一次。若客户端 retry 使用了相同 nonce 会被拒绝，重试时务必重新生成 nonce。
4. **签名样本对比：** 在 `app` 容器日志中开启 debug，对比服务端拼串与商户拼串是否一致。

---

### 4.2 回调收不到

**现象：** 订单支付成功但商户后端一直收不到 `RECHARGE_NOTIFY_URL` 回调。

**排查：**

1. **`RECHARGE_NOTIFY_URL` 必须 https：** 生产环境 SecurityValidator 强制要求外网可访问的完整 URL，且不允许 localhost。
2. **Nginx 证书：** 确认回调域名证书未过期、未自签。

   ```bash
   echo | openssl s_client -connect merchant.example.com:443 -servername merchant.example.com 2>/dev/null | openssl x509 -noout -dates
   ```

3. **防火墙 443：** 商户服务器需放行入站 443。

   ```bash
   # 商户服务器
   sudo ufw allow 443/tcp
   ```

4. **服务端日志验证：** `docker compose logs app | grep webhook` 查看回调是否发出、HTTP 状态码、是否进入重试队列。

---

### 4.3 订单一直 PENDING

**现象：** 商户下单后订单状态一直停留在 `PENDING`，资金未到账。

**排查：**

1. **区分 mock 渠道 vs 真实渠道：**

   ```bash
   docker compose exec postgres psql -U postgres -d kebaipay -c \
     "SELECT id, \"orderNo\", status, \"channelCode\" FROM \"CashierOrder\" WHERE \"orderNo\" = '<orderNo>';"
   ```

   - mock 渠道：不会自动回调，需手动触发。
   - 真实渠道：检查渠道侧是否成功受理，查 `webhook` 日志。

2. **主动触发回调（mock 场景或本地测试）：**

   ```bash
   curl -X POST http://localhost:3000/cashier/orders/<orderNo>/notify \
     -H "Content-Type: application/json"
   ```

3. **真实渠道场景：** 联系渠道侧确认回调地址是否可达，必要时手动重发（后台「订单管理 → 重发回调」）。

---

## 5. 静态资源 404

**现象：** 部署后访问 `/admin/` 或 `/static/` 返回 404。

**原因：** `nest-cli.json` 的 `compilerOptions.assets` 配置缺失或路径不对，前端构建产物未被拷贝到 `dist/`。

**解决：**

1. 检查 `nest-cli.json`：

   ```json
   {
     "compilerOptions": {
       "assets": [
         { "include": "public/**/*", "outDir": "dist/" },
         { "include": "views/**/*", "outDir": "dist/" }
       ],
       "watchAssets": true
     }
   }
   ```

2. 重新构建：

   ```bash
   npm run build
   ls dist/public    # 确认产物已拷贝
   ```

3. Docker 部署：确保 Dockerfile 的多阶段构建把 `dist/public` 一并打入运行镜像。

---

## 6. Swagger 文档打不开

**现象：** 访问 `/api/docs` 返回 404 或 500。

**原因：** 生产环境出于安全考虑隐藏了 Swagger 文档。

**解决：**

1. **临时开启（仅 staging）：**

   ```bash
   NODE_ENV=development
   ```

2. **生产环境长期方案：** 不要在生产开启 Swagger。如需联调，部署独立的 staging 环境并加 IP 白名单。
3. 若必须临时开启，加入 BasicAuth：

   ```typescript
   SwaggerModule.setup('api/docs', app, document, {
     swaggerOptions: { basicAuth: { username, password } }
   })
   ```

---

## 7. 微信/支付宝回调失败

**现象：** 渠道回调返回 5xx 或签名校验失败。

**排查：**

1. **证书过期：**

   ```bash
   # 微信平台证书有效期检查
   echo | openssl s_client -connect api.mch.weixin.qq.com:443 2>/dev/null | openssl x509 -noout -dates

   # 支付宝公钥证书有效期
   # 在支付宝开放平台 → 应用 → 接口加密方式 中查看
   ```

2. **域名问题：** 回调地址必须与平台配置的「授权回调地址」前缀完全一致，包括协议（https）。
3. **微信 V3 签名验签：** `WechatPayService` 使用 V3 API，需正确加载 `WECHAT_PAY_*` 系列环境变量（详见 `.env.example`）。
4. **支付宝 RSA2：** 验签失败时检查商户私钥与平台公钥是否配对、是否使用了 RSA2 而非 RSA1。

---

## 8. 多平台对账（S5）排错

### 8.1 已 FETCHED 拒绝重复拉取

**错误信息：**

```text
KB941: 已存在该日期的对账单，状态为 FETCHED，拒绝重复拉取
```

**原因：** `ChannelReconciliationService` 对同一渠道同一日期只允许拉取一次，避免覆盖已有数据。

**解决：**

1. **删除已有对账单重新拉取：**

   ```bash
   docker compose exec postgres psql -U postgres -d kebaipay -c \
     "DELETE FROM \"ChannelStatementItem\" WHERE \"statementId\" IN \
        (SELECT id FROM \"ChannelStatement\" WHERE \"channelCode\"='ALIPAY' AND date='2026-07-20');"
   docker compose exec postgres psql -U postgres -d kebaipay -c \
     "DELETE FROM \"ChannelStatement\" WHERE \"channelCode\"='ALIPAY' AND date='2026-07-20';"
   ```

2. **或用新日期：** 若只是想重新验证流水，可使用相邻日期拉取后人工合并。
3. **正式流程：** 已 FETCHED 状态应进入「差异处理」流程，不应反复拉取。

---

### 8.2 差异处理状态卡住

**现象：** 差异记录状态停留在 `INVESTIGATING`，无法流转到 `RESOLVED`。

**原因：** 状态机要求 `INVESTIGATING` 必须先执行 `assignDifference`（指派处理人）后才能 `resolveDifference`。

**解决步骤：**

1. **指派处理人：**

   ```bash
   curl -X POST http://localhost:3000/admin/reconciliation/differences/<diffId>/assign \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"assigneeId": "<adminUserId>"}'
   ```

2. **解决差异：**

   ```bash
   curl -X POST http://localhost:3000/admin/reconciliation/differences/<diffId>/resolve \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"resolution": "MANUAL_ADJUST", "note": "已与渠道核对一致"}'
   ```

3. 状态流转：`PENDING → INVESTIGATING → RESOLVED`，可选 `IGNORED`（误报）。

---

## 9. AI 风控审计（S3）排错

### 9.1 误判过多

**现象：** 正常操作频繁被标记为风险事件，`RiskAuditEvent` 表中 `DETECTED` 状态堆积。

**原因：** 风控规则阈值过严，或正常业务流量被误判。

**解决：**

1. **调整规则阈值：** 进入「管理后台 → 风控管理 → 自定义规则模板」，根据「规则命中分析」报告调整：

   - `single_amount` 阈值适当上调。
   - `daily_count` / `daily_amount` 按业务真实高峰配置。
   - `ip_frequency` 给办公网出口 IP 加白名单。

2. **DISMISSED 状态：** 对已确认的误报，调用人工复核接口标记为 `DISMISSED`，不计入风险统计：

   ```bash
   curl -X POST http://localhost:3000/admin/risk-audit/events/<eventId>/review \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"decision": "DISMISSED", "reason": "误报：办公网出口 IP"}'
   ```

3. 状态机：`DETECTED → REVIEWING → CONFIRMED / DISMISSED`。

---

## 10. 性能问题

### 10.1 数据库慢查询

**现象：** 接口 P99 抖动，日志中出现 `statement_timeout` 错误。

**解决：**

1. **调整 `DATABASE_STATEMENT_TIMEOUT_MS`：** 默认值偏严，复杂报表可临时调高：

   ```bash
   # .env
   DATABASE_STATEMENT_TIMEOUT_MS=30000   # 30s
   ```

2. **EXPLAIN ANALYZE 定位：**

   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM "AccountLedger"
   WHERE "userId" = '<uid>'
   ORDER BY "createdAt" DESC
   LIMIT 20;
   ```

3. **加索引：** 高频查询字段确认有索引（`userId + createdAt`、`merchantId + status` 等）。
4. **报表场景：** 财务大盘等聚合查询走只读副本或定时物化视图。

---

### 10.2 Redis 连接数耗尽

**现象：** 日志出现 `Redis: max number of clients reached` 或 `ECONNRESET`。

**解决：**

1. **调大 maxConnections：** 在 `.env` 配置（或 Redis 配置文件）：

   ```bash
   # Redis 服务端
   maxclients 10000

   # KeBaiPay 应用端 RedisService 池
   REDIS_MAX_CONNECTIONS=200
   ```

2. **检查是否有连接泄漏：** 应用层使用 `ioredis` 时确保错误回调中释放连接。
3. **监控：** Prometheus `/metrics` 中关注 `redis_connected_clients` 指标。

---

### 10.3 内存泄漏

**现象：** Node 进程 RSS 持续上涨，最终被 OOM kill。

**解决：**

1. **调大堆内存：**

   ```bash
   node --max-old-space-size=2048 dist/main.js
   # 或 PM2
   pm2 start ecosystem.config.js --max-memory-restart 2G
   ```

2. **PM2 监控：**

   ```bash
   pm2 monit
   pm2 logs kebaipay --lines 200
   ```

3. **Docker 部署：** 在 `docker-compose.yml` 中设置内存上限（已默认 1g），并配置 OOM 自动重启。
4. **定位泄漏：** 通过 `--inspect` 启动后用 Chrome DevTools 抓 heap snapshot 对比。

---

## 11. 日志查看

### 11.1 Docker 模式

```bash
# 实时跟踪 app 日志
docker compose logs -f app

# 只看最近 100 行
docker compose logs --tail 100 app

# 按时间段过滤
docker compose logs --since 30m app
docker compose logs --since 2026-07-21T10:00:00 --until 2026-07-21T11:00:00 app

# 多服务一起看
docker compose logs -f app postgres redis
```

### 11.2 裸机模式

```bash
# PM2
pm2 logs kebaipay
pm2 logs kebaipay --lines 200 --err

# systemd
journalctl -u kebaipay -f
journalctl -u kebaipay --since "1 hour ago"
```

### 11.3 日志结构

KeBaiPay 使用 pino JSON 格式输出，常见字段：

| 字段 | 说明 |
|---|---|
| `time` | ISO 8601 时间戳 |
| `level` | 日志级别（10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal） |
| `msg` | 日志消息 |
| `traceId` | 请求级链路 ID（由 `X-Request-Id` 注入，跨服务透传） |
| `userId` / `adminId` | 当前操作主体 |
| `module` | 模块名（如 `TransferService`） |
| `err` | 错误对象（含 stack、code） |
| `durationMs` | 耗时（用于慢调用追踪） |

**示例：**

```json
{"level":30,"time":1721539200000,"traceId":"abc-123","userId":"u_001","module":"TransferService","msg":"transfer completed","durationMs":45}
```

可对接 ELK / Loki / Datadog 做集中检索。

---

## 12. 紧急联系

### 12.1 提交 issue 流程

1. 复现问题，收集以下信息：
   - KeBaiPay 版本（`cat package.json | grep version`）
   - 部署方式（docker / pm2 / k8s）
   - 完整错误日志（脱敏后）
   - 复现步骤
2. 在仓库提交 issue，标题前缀按问题类型：`[deploy]` / `[auth]` / `[fund]` / `[api]` / `[reconciliation]` / `[risk]`。
3. 紧急生产事故请同步通知值班 oncall。

### 12.2 日志收集脚本

```bash
#!/usr/bin/env bash
# scripts/collect-logs.sh
set -euo pipefail

OUTDIR="/tmp/kebaipay-logs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTDIR"

# 应用日志
docker compose logs --since 2h app       > "$OUTDIR/app.log"        2>&1
docker compose logs --since 2h postgres  > "$OUTDIR/postgres.log"   2>&1
docker compose logs --since 2h redis     > "$OUTDIR/redis.log"      2>&1

# 容器状态
docker compose ps                        > "$OUTDIR/ps.txt"         2>&1
docker compose top app                   > "$OUTDIR/top-app.txt"    2>&1

# 迁移状态
docker compose exec -T app npx prisma migrate status > "$OUTDIR/migrate-status.txt" 2>&1

# 健康检查
curl -s http://localhost:3000/health/ready > "$OUTDIR/health.json"

tar -czf "$OUTDIR.tar.gz" -C "$OUTDIR" .
echo "收集完成：$OUTDIR.tar.gz"
```

执行：

```bash
chmod +x scripts/collect-logs.sh
./scripts/collect-logs.sh
# 将生成的 .tar.gz 上传给 oncall
```
