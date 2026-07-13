# 科佰支付 KeBaiPay

个人钱包 + 商户收款平台，前后端一体（NestJS + H5 静态页同源部署）。

## 技术栈

- NestJS 11 + TypeScript 6
- Prisma 7 + PostgreSQL 16/17（不再支持 SQLite）
- Redis 7（生产环境必填，资金操作靠它加分布式锁）
- H5 静态页面（由 NestJS 静态托管，无需单独部署前端）

---

## 部署方式选哪个

| 场景 | 推荐方式 |
|------|---------|
| 新服务器，啥都没装 | **Docker Compose（推荐）** |
| 已有 PostgreSQL + Node 环境 | 裸机部署 |

两种方式二选一，不要混着用。

---

## 一、Docker Compose 部署（推荐）

服务器上只需装 Docker 和 Docker Compose，其他什么都不用装。

### 1. 装 Docker（如果还没装）

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 验证
docker --version
docker compose version
```

### 2. 拷代码到服务器

```bash
# 任选一种：scp / rsync / git clone
scp -r kebaipay root@your-server:/opt/
ssh root@your-server
cd /opt/kebaipay
```

### 3. 配置 .env（最容易踩坑的一步）

```bash
cp .env.example .env
vi .env
```

**必须改掉这 6 个值**，留默认值会被 `SecurityValidatorService` 拒绝启动：

```bash
POSTGRES_PASSWORD=换成你自己的强密码      # PostgreSQL 数据库密码
JWT_USER_SECRET=随机字符串32位以上         # 用户端 JWT 密钥
JWT_ADMIN_SECRET=另一个不同的随机字符串    # 管理端 JWT 密钥（必须和上面不同）
ADMIN_DEFAULT_PASSWORD=Abc12345           # 管理员 admin 初始密码（8位以上含大小写+数字）
ENCRYPTION_KEY=随机字符串32位以上         # AES 加密密钥
REDIS_PASSWORD=换成你自己的强密码          # Redis 密码
```

生产环境还建议改：

```bash
CORS_ORIGINS=https://pay.yourdomain.com   # 改成你的域名，逗号分隔多个
CASHIER_BASE_URL=https://pay.yourdomain.com
```

生成随机密钥的小技巧：

```bash
openssl rand -base64 48    # 生成 48 位随机串
openssl rand -hex 32       # 生成 32 位十六进制
```

### 4. 一键启动

```bash
docker compose up -d --build
```

第一次会拉镜像 + 构建，大概 3-5 分钟。完成后：

```bash
# 看容器状态，三个都应该是 Up
docker compose ps

# 看应用日志
docker compose logs -f app
```

看到 `Nest application successfully started` 就说明启动成功了。

### 5. 初始化管理员账号

```bash
docker compose exec app npx prisma db seed
```

这会创建管理员 `admin`（密码就是 `.env` 里的 `ADMIN_DEFAULT_PASSWORD`）和测试用户。

### 6. 验证

```bash
# 健康检查
curl http://localhost:3000/health/ready
# 返回 {"status":"ok",...} 即成功

# 浏览器访问
# 用户首页：http://你的服务器IP:3000/
# 管理员登录：http://你的服务器IP:3000/#adminLogin
```

---

## 二、裸机部署（不用 Docker）

适合已有 PostgreSQL/Node 环境的服务器。

### 环境要求

- Node.js >= 20.0.0（**必须 20 以上**，NestJS 11 + TypeScript 6 要求）
- PostgreSQL >= 16
- Redis >= 7（可选，不配会降级为进程内缓存，**生产环境强烈建议配**）

### 步骤

```bash
# 1. 安装依赖
npm ci

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填上所有值，DATABASE_URL 指向你的 PG 实例

# 3. 生成 Prisma Client
npx prisma generate

# 4. 执行数据库迁移（建表）
npx prisma migrate deploy

# 5. 创建管理员账号 + 测试用户
npx prisma db seed

# 6. 构建
npm run build

# 7. 启动
NODE_ENV=production node dist/main.js
```

推荐用 PM2 管理进程：

```bash
npm install -g pm2
pm2 start dist/main.js --name kebaipay
pm2 save
pm2 startup   # 设置开机自启
```

或者用项目自带的脚本：

```bash
# Linux/Mac
chmod +x start.sh && ./start.sh

# Windows
start.bat
```

---

## 三、环境变量速查表

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABASE_URL` | 是（裸机） | 无 | PostgreSQL 连接串，docker compose 模式下自动注入 |
| `POSTGRES_USER` | 否 | postgres | PostgreSQL 用户名，docker compose 模式下自动注入 |
| `POSTGRES_PASSWORD` | **是** | 无 | PostgreSQL 密码，docker compose 必填 |
| `POSTGRES_DB` | 否 | kebaipay | PostgreSQL 数据库名，docker compose 模式下自动注入 |
| `REDIS_URL` | 生产必填 | 无 | Redis 连接串，生产环境 SecurityValidator 强制要求配置 |
| `REDIS_PASSWORD` | 否 | redis | Redis 密码 |
| `JWT_USER_SECRET` | **是** | 无 | 用户端 JWT 签名密钥，必须改 |
| `JWT_ADMIN_SECRET` | **是** | 无 | 管理端 JWT 签名密钥，必须改 |
| `ADMIN_DEFAULT_PASSWORD` | **是** | 无 | 管理员 admin 初始密码，必须改 |
| `ENCRYPTION_KEY` | **是** | 无 | AES 加密密钥，32 字符以上，必须改 |
| `PORT` | 否 | 3000 | 服务监听端口 |
| `NODE_ENV` | 否 | development | 设为 production 会启用安全校验、隐藏 Swagger |
| `CORS_ORIGINS` | 否 | http://localhost:3000 | 允许的跨域来源，逗号分隔，生产环境必须改成你的域名 |
| `CASHIER_BASE_URL` | 否 | http://localhost:3000 | 收银台对外地址 |
| `RECHARGE_NOTIFY_URL` | 否 | 空 | 充值回调通知地址 |

---

## 四、Nginx 反向代理 + HTTPS

生产环境建议前面挂一层 Nginx 做 HTTPS 终止：

```nginx
upstream kebaipay {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name pay.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pay.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/pay.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pay.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://kebaipay;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /health {
        proxy_pass http://kebaipay;
        access_log off;
    }
}
```

用 Let's Encrypt 申请免费证书：

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d pay.yourdomain.com
```

---

## 五、常用运维命令

```bash
# Docker Compose 模式
docker compose ps                                    # 查看容器状态
docker compose logs -f app                          # 实时看应用日志
docker compose restart app                           # 重启应用
docker compose down                                  # 停止所有服务
docker compose pull && docker compose up -d --build  # 更新代码后重新部署
docker compose exec app sh                           # 进入应用容器
docker compose exec postgres psql -U postgres -d kebaipay   # 进数据库

# 数据库备份
docker compose exec -T postgres pg_dump -U postgres kebaipay > backup_$(date +%Y%m%d).sql

# 数据库恢复
cat backup_20260704.sql | docker compose exec -T postgres psql -U postgres -d kebaipay

# 定时每日备份（crontab -e）
0 3 * * * cd /opt/kebaipay && docker compose exec -T postgres pg_dump -U postgres kebaipay | gzip > /backups/kebaipay_$(date +\%Y\%m\%d).sql.gz
```

---

## 六、常见错误对照表（部署排错必看）

### 1. 容器启动失败 / 反复重启

#### 错误现象 1：`SecurityValidatorService` 拒绝启动

```
[FATAL] Security validation failed:
  - JWT_USER_SECRET is using default value
  - ENCRYPTION_KEY is using default value
  - ADMIN_DEFAULT_PASSWORD is using default value
```

**原因**：`.env` 里的 6 个必填密钥还是默认值或为空。

**解决**：打开 `.env`，把这 6 个值都改成你自己的：
- `POSTGRES_PASSWORD`
- `JWT_USER_SECRET`
- `JWT_ADMIN_SECRET`
- `ADMIN_DEFAULT_PASSWORD`
- `ENCRYPTION_KEY`
- `REDIS_PASSWORD`

改完后重启：`docker compose up -d`

---

#### 错误现象 2：`CORS_ORIGINS is not configured in production`

```
[FATAL] Security validation failed:
  - CORS_ORIGINS is not configured in production
```

**原因**：生产环境（`NODE_ENV=production`）必须显式配置 `CORS_ORIGINS`，不能留默认的 `localhost`。

**解决**：`.env` 里改成你的域名：
```bash
CORS_ORIGINS=https://pay.yourdomain.com
```

---

#### 错误现象 3：Prisma 连不上数据库

```
Error: P1001: Can't reach database server at postgres:5432
```

**原因**：app 容器启动时 PostgreSQL 还没准备好。`docker-compose.yml` 已经配了 healthcheck 依赖重试，正常会自动等。如果反复失败：

1. 看 PG 容器是否起来：`docker compose ps postgres`
2. 看 PG 日志：`docker compose logs postgres`
3. 检查 `POSTGRES_PASSWORD` 是否和 `DATABASE_URL` 里的密码一致

---

#### 错误现象 4：端口 3000 被占用

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
```

**原因**：服务器上别的程序占了 3000 端口。

**解决**：要么杀掉占用进程，要么改 `docker-compose.yml` 里的端口映射：
```yaml
ports:
  - "8080:3000"   # 把宿主机 8080 映射到容器 3000
```

---

### 2. Prisma 迁移失败

#### 错误现象 1：`PrismaClientInitializationError`

```
Error: PrismaClientInitializationError: Database connection error
```

**原因**：`DATABASE_URL` 配错，或者 PG 容器没起来。

**解决**：
```bash
docker compose ps                    # 确认 postgres 是 Up
docker compose exec postgres pg_isready -U postgres   # 测试 PG 是否可连
```

---

#### 错误现象 2：`migrate deploy` 报迁移文件错误

```
Error: P3009: migration failed to apply
```

**原因**：`prisma/migrations` 目录里有空的或损坏的迁移文件。

**解决**：检查 `prisma/migrations/` 下每个目录，确保都有 `migration.sql` 文件且不为空。如果只是开发环境，可以直接重置：
```bash
docker compose exec app npx prisma migrate reset --force
```

---

### 3. 构建失败

#### 错误现象 1：`prisma generate` 报 `Cannot resolve environment variable: DATABASE_URL`

```
Error: PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL
```

**原因**：Prisma 7 的 `prisma.config.js` 用 `env('DATABASE_URL')`，构建时这个变量必须存在。

**解决**：Docker 构建已经在 Dockerfile 里加了占位 `ENV DATABASE_URL=...`，理论上不会出现。如果裸机部署遇到，手动 export：
```bash
export DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
npx prisma generate
```

---

### 4. 登录 / 认证问题

#### 错误现象 1：管理员登录提示密码错误

**原因**：`ADMIN_DEFAULT_PASSWORD` 改了但没重新 seed，或者 seed 时数据库已有 admin。

**解决**：
```bash
# 直接进数据库改密码（最快）
docker compose exec postgres psql -U postgres -d kebaipay \
  -c "DELETE FROM \"AdminUser\" WHERE username='admin';"
docker compose exec app npx prisma db seed
```

---

#### 错误现象 2：用户登录返回 429 Too Many Requests

**原因**：同一账号 15 分钟内失败 5 次，触发了暴力破解锁定。

**解决**：等 15 分钟自动解锁，或者：
```bash
docker compose exec redis redis-cli
# 清掉锁定计数
DEL auth:login:fail:用户手机号
```

---

#### 错误现象 3：登录后立即被踢回登录页

**原因**：`JWT_USER_SECRET` 改了，旧 token 全部失效（正常现象）。

**解决**：重新登录就行。

---

### 5. 资金操作报错

#### 错误现象 1：`Failed to acquire lock within timeout`

**原因**：Redis 分布式锁没拿到，可能是上一次操作没释放锁。

**解决**：等几秒重试。如果持续出现：
```bash
docker compose restart redis
```

---

#### 错误现象 2：转账/提现报 `余额不足`

**原因**：真的没钱了，或者上次操作还在处理中（前端没刷新）。

**解决**：刷新页面看最新余额。

---

### 6. 静态资源 404

#### 错误现象：访问首页白屏，控制台报 `404 Not Found: /app.js`

**原因**：`nest-cli.json` 的 `assets` 配置没把 `public/` 目录包含进去，构建时静态文件没拷贝到 `dist/`。

**解决**：检查 `nest-cli.json`，确保：
```json
{
  "compilerOptions": {
    "assets": ["public/**/*"],
    "watchAssets": true
  }
}
```

---

### 7. Swagger 文档打不开

**原因**：生产环境（`NODE_ENV=production`）出于安全考虑关闭了 Swagger。

**解决**：本地开发或测试环境访问 `/api/docs`。生产环境要用 API 文档，临时改 `NODE_ENV=development` 重启。

---

### 8. 微信/支付宝回调失败

**原因**：`RECHARGE_NOTIFY_URL` 没配成 https 地址，或者 Nginx 证书过期。

**解决**：
1. `.env` 里把 `RECHARGE_NOTIFY_URL` 改成 `https://pay.yourdomain.com/api/recharge/notify`
2. 确认 Nginx 证书有效
3. 确认防火墙放行了 443 端口

---

### 9. docker-compose up 报 `POSTGRES_PASSWORD must be set`

```
ERROR: POSTGRES_PASSWORD must be set in .env
```

**原因**：`docker-compose.yml` 用了 `${POSTGRES_PASSWORD:?...}` 语法，没配就硬失败。

**解决**：`.env` 里必须加 `POSTGRES_PASSWORD=你的密码`。

---

### 10. 构建时拉镜像超慢

**原因**：国内服务器访问 Docker Hub 慢。

**解决**：配个国内镜像源，编辑 `/etc/docker/daemon.json`：
```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com"
  ]
}
```
重启 Docker：`systemctl restart docker`

---

## 七、本地开发

```bash
# 1. 启动 PostgreSQL + Redis 容器（首次会拉镜像）
docker compose -f docker-compose.dev.yml up -d

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# DATABASE_URL 默认指向本地 PG 容器

# 4. 同步数据库 schema（首次会跑 migration）
npx prisma migrate dev

# 5. 启动开发服务（热重载）
npm run start:dev
```

访问 `http://localhost:3000` 打开 H5 钱包。

### 常用脚本

```bash
npm run build         # 构建
npm run start:prod    # 生产启动
npm run db:studio     # 打开 Prisma Studio（可视化数据库）
npm run db:seed       # 初始化管理员 + 测试用户数据
npm run test          # 单元测试
npm run test:e2e      # 端到端测试
npm run migrate:dev   # 开发环境跑迁移（会改 schema）
npm run migrate:deploy# 生产环境部署迁移
```

---

## 八、运维端点

| 端点 | 说明 |
| --- | --- |
| `GET /health` | 存活探针（liveness），进程在跑即返回 ok |
| `GET /health/ready` | 就绪探针（readiness），检查 DB 与 Redis 连通性 |
| `GET /health/channels` | 查看支付渠道状态 |
| `GET /health/channels/summary` | 支付渠道健康摘要 |
| `GET /health/schedules` | 调度任务健康状态 |
| `GET /api/docs` | Swagger API 文档（仅非生产环境） |

---

## 九、项目结构

```
src/
  auth/            用户 JWT 鉴权
  users/           用户、实名、支付密码
  accounts/        账户余额、资金流水（ledger）
  transactions/    充值、交易订单
  transfers/       转账
  withdrawals/     提现
  merchants/       商户入驻、应用与配置
  cashier/         统一收银台
  open-api/        开放 API 与 HMAC 签名验证
  admin/           管理后台
  finance/         财务统计与对账
  payment-channels/ 微信 / 支付宝支付渠道
  webhooks/        支付渠道回调
  redis/           Redis 封装（分布式锁 / 缓存）
  crypto/          敏感数据 AES-256-GCM 加解密
  security/        启动安全校验
  risk/            风控引擎
  health/          健康检查（存活 / 就绪 / 渠道）
  common/          中间件、拦截器、工具函数
  prisma/          Prisma 客户端
  notifications/   通知（邮件等）
  audit/           审计日志
  sms/             短信
  red-packets/     红包
  qr-codes/        收款码
  bills/           账单
public/             H5 钱包页面（前端静态资源）
prisma/             Prisma schema + migrations + seed
```

---

## 十、开发约定

- 金额数据库用"分"，接口用"元"。
- 资金操作必须走 Prisma `$transaction` 事务。
- 开放 API 带 HMAC-SHA256 签名。
- DTO 必须加 `class-validator` 校验，禁止 `any` 类型。
- 银行卡号、身份证号用 AES-256-GCM 加密入库。

---

## 十一、注意事项

- `.env` 已加入 `.gitignore`，不会进仓库，**但部署时一定要在服务器上创建**。
- 生产环境必须修改 6 个必填密钥，否则启动直接被拦。
- 生产环境必须配 Redis（资金操作的并发安全靠它）。
- `NODE_ENV=production` 会自动启用安全校验、隐藏 Swagger 文档。
- 数据库迁移在容器启动时自动执行（`docker-entrypoint.sh`），不用手动跑。
- 首次部署后必须跑 `npx prisma db seed` 创建管理员账号。
