# KeBaiPay 部署指南

> 生产环境部署、配置、运维与故障恢复的**权威参考**。  
> 适用于 KeBaiPay v2.0（NestJS 11 + Prisma 7 + PostgreSQL 16 + Redis 7）。

## 目录

- [1. 部署架构图](#1-部署架构图)
- [2. 环境要求](#2-环境要求)
- [3. 部署方式对比](#3-部署方式对比)
- [4. Docker Compose 部署（推荐生产）](#4-docker-compose-部署推荐生产)
- [5. 裸机 + PM2 部署](#5-裸机--pm2-部署)
- [6. Kubernetes 部署](#6-kubernetes-部署)
- [7. 升级与迁移流程](#7-升级与迁移流程)
- [8. 监控与日志](#8-监控与日志)
- [9. 性能调优](#9-性能调优)
- [10. 安全加固 Checklist](#10-安全加固-checklist)
- [11. 故障恢复](#11-故障恢复)
- [12. 运维命令速查](#12-运维命令速查)

---

## 1. 部署架构图

```mermaid
flowchart LR
    Client[客户端<br/>浏览器 / 移动端 / 商户后端]
    subgraph Edge[边缘层]
        Nginx[Nginx<br/>TLS 1.2+ / HSTS / 反向代理]
    end
    subgraph AppTier[应用层]
        App[NestJS App<br/>:3000<br/>PM2 cluster / docker / k8s]
    end
    subgraph DataTier[数据层]
        PG[(PostgreSQL 16<br/>主库)]
        Redis[(Redis 7<br/>分布式锁 + 限流 + nonce)]
    end
    subgraph External[外部服务]
        WeChat[微信支付]
        Alipay[支付宝]
        SMS[短信服务<br/>阿里云 / 腾讯云 / 华为云]
        SMTP[SMTP 邮件]
        OTEL[OTLP Collector<br/>Jaeger / Tempo]
        Sentry[Sentry]
    end

    Client -->|HTTPS 443| Nginx
    Nginx -->|HTTP 3000| App
    App --> PG
    App --> Redis
    App -->|HTTPS| WeChat
    App -->|HTTPS| Alipay
    App -->|HTTPS API| SMS
    App -->|SMTP/SUBMISSION| SMTP
    App -->|OTLP HTTP| OTEL
    App -->|异常上报| Sentry
```

**关键流量路径**：客户端 → Nginx (TLS) → NestJS App → PostgreSQL + Redis；App 主动调用微信/支付宝/短信/SMTP/OTLP。

---

## 2. 环境要求

| 组件 | 最低版本 | 必填 | 说明 |
|------|---------|------|------|
| Node.js | >= 20 | 是（裸机） | NestJS 11 + TypeScript 6 + Prisma 7 要求 |
| PostgreSQL | >= 16 | 是 | 不再支持 SQLite，依赖 JSONB / 部分索引 |
| Redis | >= 7 | 是（生产） | 分布式锁、nonce 防重放、滑动窗口限流 |
| Docker | >= 24 | 否 | 容器化部署（推荐） |
| Docker Compose | >= 2.20 | 否 | 编排 app + postgres + redis |
| Nginx | >= 1.20 | 否（推荐） | TLS 反向代理 + HSTS + 限速 |

> 生产环境 `SecurityValidatorService` 会强制校验 Redis、CORS、回调 URL，缺失或使用默认密钥将拒绝启动。

---

## 3. 部署方式对比

| 方式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **Docker Compose**（推荐生产） | 单机生产、中小规模商户 | 一键起 app+PG+Redis；版本一致；升级回滚简单 | 单机故障域；水平扩展需手动 |
| **裸机 + PM2** | 已有 PG/Redis 实例；私有云 | 资源占用低；调试方便；可复用现有 DBA 运维 | 依赖手动管理；迁移需重新部署 |
| **K8s** | 大型部署、多副本、跨可用区 | 自愈、滚动升级、HPA 弹性伸缩 | 学习曲线高；YAML 维护成本 |
| **开发环境**（docker-compose.dev.yml） | 本地开发 | 只起 PG+Redis，代码在宿主机热重载 | 不可用于生产 |

---

## 4. Docker Compose 部署（推荐生产）

### 4.1 安装 Docker

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# 验证
docker --version          # 期望 >= 24.0
docker compose version    # 期望 >= 2.20
```

### 4.2 拷贝代码

```bash
sudo mkdir -p /opt/kebaipay
sudo chown $USER:$USER /opt/kebaipay
cd /opt/kebaipay

# 方式一：git clone（推荐，便于后续升级）
# 任选其一，国内服务器推荐 gitcode 镜像访问更快
git clone https://github.com/weed33834/KeBaiPay.git .
# 或：git clone https://gitcode.com/badhope/KeBaiPay.git .

# 方式二：上传 tar 包
# scp kebaipay-2.0.0.tar.gz user@your-server:/opt/kebaipay/
# tar -xzf kebaipay-2.0.0.tar.gz --strip-components=1
```

### 4.3 配置 .env（必须改的 6 个 secret）

```bash
cp .env.example .env
vim .env
```

**必须修改的 6 项**（生产环境未改会拒绝启动）：

```bash
# 1. PostgreSQL 密码
POSTGRES_PASSWORD="your-strong-postgres-password-2026"

# 2. JWT 用户密钥（32 字符以上，含大小写+数字）
JWT_USER_SECRET="your-user-jwt-secret-32chars-2026-AbCdEf"

# 3. JWT 管理员密钥（必须与 USER 不同）
JWT_ADMIN_SECRET="your-admin-jwt-secret-32chars-2026-XyZ123"

# 4. 管理员初始密码（8 字符以上，含大小写+数字）
ADMIN_DEFAULT_PASSWORD="ChangeAdmin2026"

# 5. AES 加密密钥（32 字符以上，加密身份证/银行卡）
ENCRYPTION_KEY="your-aes-256-encryption-key-32chars-2026"

# 6. Redis 密码
REDIS_PASSWORD="your-redis-password-2026"
```

**其他必填项**：

```bash
NODE_ENV="production"
CORS_ORIGINS="https://your-domain.com,https://pay.your-domain.com"
RECHARGE_NOTIFY_URL="https://api.your-domain.com/webhooks/recharge"
CASHIER_BASE_URL="https://pay.your-domain.com"

# 支付渠道（生产必须配置真实渠道，禁止 mock）
ALIPAY_APP_ID="2021000xxxxxxxxx"
ALIPAY_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
ALIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
ALIPAY_NOTIFY_URL="https://api.your-domain.com/webhooks/alipay"

WECHAT_PAY_MCH_ID="16xxxxx"
WECHAT_PAY_API_V3_KEY="32-char-api-v3-key"
WECHAT_PAY_PRIVATE_KEY="<apiclient_key.pem 内容>"
WECHAT_PAY_CERT_SERIAL_NO="<证书序列号>"
WECHAT_PAY_NOTIFY_URL="https://api.your-domain.com/webhooks/wechat"

# 短信（生产禁止 mock）
SMS_PROVIDER="aliyun"   # 或 tencent / huawei
SMS_SIGN_NAME="科佰支付"
SMS_TEMPLATE_CODE="SMS_xxxxx"
SMS_ACCESS_KEY_ID="your-aliyun-ak"
SMS_ACCESS_KEY_SECRET="your-aliyun-sk"

# 可观测性（强烈建议启用）
OTEL_SERVICE_NAME="kebaipay"
OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
SENTRY_DSN="https://xxxxx@sentry.io/xxx"
```

> **说明**：`DATABASE_URL` 与 `REDIS_URL` 在 `docker-compose.yml` 中由容器间地址自动注入，`.env` 中无需手动配置这两项。

### 4.4 一键启动

```bash
cd /opt/kebaipay
docker compose up -d --build
```

构建过程：
- builder 阶段：`npm ci` + `prisma generate` + `nest build`
- runner 阶段：拷贝 `node_modules` + `dist` + `prisma`，以非 root 用户 `nestjs` 运行
- `docker-entrypoint.sh` 自动执行 `prisma migrate deploy`，成功后 `su-exec` 降权启动 node

### 4.5 验证启动

```bash
# 查看容器状态
docker compose ps

# 期望输出：
# NAME                  STATUS                   PORTS
# kebaipay-app          Up (healthy)             0.0.0.0:3000->3000/tcp
# kebaipay-postgres     Up (healthy)             5432/tcp
# kebaipay-redis        Up (healthy)             6379/tcp

# 查看应用日志（关注是否出现 "Database connection established" 与 "生产环境安全校验通过"）
docker compose logs -f app

# 健康检查
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

### 4.6 初始化管理员

镜像启动时会自动执行 `prisma migrate deploy`，但 `seed`（创建管理员账号）需手动执行一次：

```bash
# 进入 app 容器执行 seed
docker compose exec app npx prisma db seed

# 期望输出：
#   管理员账户已创建: admin / 密码来自 ADMIN_DEFAULT_PASSWORD
#   开始 seed...
#   seed 完成
```

完成后使用 `admin` + `ADMIN_DEFAULT_PASSWORD` 登录管理后台，**立即修改密码**。

### 4.7 配置 Nginx 反向代理 + HTTPS

> Docker Compose 部署中，Nginx 建议运行在宿主机或独立容器，仅代理到 `127.0.0.1:3000`。

**安装 Nginx + Certbot**：

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

**`/etc/nginx/sites-available/kebaipay.conf`**：

```nginx
upstream kebaipay {
    server 127.0.0.1:3000;
    keepalive 64;
}

# HTTP → HTTPS 跳转
server {
    listen 80;
    listen [::]:80;
    server_name api.your-domain.com pay.your-domain.com;
    return 301 https://$host$request_uri;
}

# API 主站
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.your-domain.com;

    # TLS 证书（由 certbot 自动生成）
    ssl_certificate     /etc/letsencrypt/live/api.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    access_log /var/log/nginx/kebaipay-api-access.log;
    error_log  /var/log/nginx/kebaipay-api-error.log;

    client_max_body_size 2m;

    # 健康检查端点（不记日志）
    location ~ ^/health {
        proxy_pass http://kebaipay;
        access_log off;
    }

    # Prometheus 指标（仅内网）
    location = /metrics {
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny  all;
        proxy_pass http://kebaipay;
        access_log off;
    }

    # API 反向代理
    location / {
        proxy_pass http://kebaipay;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout    60s;
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
    }
}

# 收银台前端（静态文件）
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pay.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/api.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    root /var/www/kebaipay-cashier;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://kebaipay;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**启用站点 + 申请证书**：

```bash
sudo ln -s /etc/nginx/sites-available/kebaipay.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 申请 Let's Encrypt 证书（自动改写 nginx 配置加上 TLS）
sudo certbot --nginx -d api.your-domain.com -d pay.your-domain.com \
  --non-interactive --agree-tos -m admin@your-domain.com

# 测试自动续期
sudo certbot renew --dry-run
```

### 4.8 数据库定时备份

**创建备份脚本 `/opt/kebaipay/scripts/backup-db.sh`**：

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/data/backups/kebaipay"
DATE=$(date +%Y%m%d_%H%M%S)
RETAIN_DAYS=30
CONTAINER="kebaipay-postgres"

mkdir -p "$BACKUP_DIR"

# 通过 docker exec 调用容器内 pg_dump
docker compose -f /opt/kebaipay/docker-compose.yml exec -T "$CONTAINER" \
  pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-kebaipay}" \
  | gzip > "$BACKUP_DIR/kebaipay_$DATE.sql.gz"

# 上传到 OSS（可选）
# aws s3 cp "$BACKUP_DIR/kebaipay_$DATE.sql.gz" s3://your-bucket/kebaipay-backup/

# 清理过期备份
find "$BACKUP_DIR" -name "kebaipay_*.sql.gz" -mtime +${RETAIN_DAYS} -delete

echo "[$(date)] Backup saved: kebaipay_$DATE.sql.gz"
```

```bash
sudo chmod +x /opt/kebaipay/scripts/backup-db.sh

# 添加 crontab（每天凌晨 3 点备份）
sudo crontab -e
# 添加以下行：
0 3 * * * /opt/kebaipay/scripts/backup-db.sh >> /var/log/kebaipay-backup.log 2>&1
```

### 4.9 升级流程

```bash
cd /opt/kebaipay

# 1. 备份当前数据库（升级前必做！）
docker compose exec -T postgres pg_dump -U postgres kebaipay | gzip > /data/backups/kebaipay-pre-upgrade-$(date +%Y%m%d_%H%M%S).sql.gz

# 2. 拉取新代码
git fetch --tags
git checkout v2.1.0   # 替换为目标版本

# 3. 检查 .env.example 是否有新增变量，按需合并到 .env
diff .env.example .env

# 4. 重新构建并启动（entrypoint 会自动执行 prisma migrate deploy）
docker compose up -d --build

# 5. 验证
docker compose ps
curl http://localhost:3000/health/ready
docker compose logs -f app
```

### 4.10 回滚流程

```bash
cd /opt/kebaipay

# 1. 停止应用（保留数据库运行）
docker compose stop app

# 2. 代码回滚到上一个版本
git checkout v2.0.0   # 替换为上一个稳定版本

# 3. 数据库回滚（如果迁移修改了 schema）
#    警告：prisma migrate 不支持自动 down，需要手工编写回滚 SQL
#    或从备份恢复：
gunzip -c /data/backups/kebaipay-pre-upgrade-YYYYMMDD_HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U postgres -d kebaipay

# 4. 重新构建启动
docker compose up -d --build app

# 5. 验证
curl http://localhost:3000/health/ready
```

> **警告**：数据库迁移**不可逆**。任何破坏性迁移（删列、改类型）必须在升级前完整备份并测试。

---

## 5. 裸机 + PM2 部署

### 5.1 安装 Node.js 20

```bash
# NodeSource 官方源
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node --version    # v20.x
npm --version
```

### 5.2 安装 PostgreSQL 16

```bash
# 添加官方源
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg

sudo apt update
sudo apt install -y postgresql-16

# 启动 + 开机自启
sudo systemctl enable --now postgresql

# 创建数据库与用户
sudo -u postgres psql <<EOF
CREATE USER kebaipay WITH PASSWORD 'your-strong-postgres-password-2026';
CREATE DATABASE kebaipay OWNER kebaipay;
GRANT ALL PRIVILEGES ON DATABASE kebaipay TO kebaipay;
EOF

# 调整连接数（按需）
sudo vim /etc/postgresql/16/main/postgresql.conf
# max_connections = 200
# shared_buffers = 512MB
sudo systemctl restart postgresql
```

### 5.3 安装 Redis 7

```bash
# 添加官方 Redis 源
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list

sudo apt update
sudo apt install -y redis

# 配置密码 + 持久化
sudo vim /etc/redis/redis.conf
```

```conf
# /etc/redis/redis.conf 关键项
requirepass your-redis-password-2026
appendonly yes
appendfsync everysec
maxmemory 512mb
maxmemory-policy allkeys-lru
bind 127.0.0.1 ::1
```

```bash
sudo systemctl enable --now redis-server
redis-cli -a your-redis-password-2026 ping    # 期望 PONG
```

### 5.4 拷贝代码 + npm ci

```bash
sudo mkdir -p /opt/kebaipay
sudo chown $USER:$USER /opt/kebaipay
cd /opt/kebaipay

git clone https://github.com/weed33834/KeBaiPay.git .
# 或国内镜像：git clone https://gitcode.com/badhope/KeBaiPay.git .

# 安装依赖（生产 + dev，因为 build 需要 typescript）
npm ci
```

### 5.5 配置 .env

```bash
cp .env.example .env
vim .env
```

裸机模式必须手动配置 `DATABASE_URL` 与 `REDIS_URL`：

```bash
DATABASE_URL="postgresql://kebaipay:your-strong-postgres-password-2026@localhost:5432/kebaipay?schema=public"
REDIS_URL="redis://:your-redis-password-2026@localhost:6379"

POSTGRES_USER="kebaipay"
POSTGRES_PASSWORD="your-strong-postgres-password-2026"
POSTGRES_DB="kebaipay"

JWT_USER_SECRET="your-user-jwt-secret-32chars-2026-AbCdEf"
JWT_ADMIN_SECRET="your-admin-jwt-secret-32chars-2026-XyZ123"
ADMIN_DEFAULT_PASSWORD="ChangeAdmin2026"
ENCRYPTION_KEY="your-aes-256-encryption-key-32chars-2026"
REDIS_PASSWORD="your-redis-password-2026"

NODE_ENV="production"
PORT=3000
CORS_ORIGINS="https://your-domain.com"
RECHARGE_NOTIFY_URL="https://api.your-domain.com/webhooks/recharge"
CASHIER_BASE_URL="https://pay.your-domain.com"
```

### 5.6 prisma generate + migrate deploy + seed

```bash
# 生成 Prisma Client
npm run db:generate

# 部署迁移
npm run migrate:deploy

# 查看迁移状态
npm run migrate:status

# 初始化管理员
npm run db:seed
```

### 5.7 npm run build

```bash
# 构建（包含 prisma generate + nest build）
npm run build

# 产物在 dist/
ls dist/
```

### 5.8 PM2 启动

```bash
sudo npm install -g pm2

# 写 ecosystem.config.js
cat > /opt/kebaipay/ecosystem.config.js <<'EOF'
module.exports = {
  apps: [{
    name: 'kebaipay',
    script: 'dist/main.js',
    instances: 'max',          // cluster 模式，按 CPU 核数
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024',
    env: {
      NODE_ENV: 'production',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/kebaipay/error.log',
    out_file: '/var/log/kebaipay/out.log',
    merge_logs: true,
    kill_timeout: 10000,        // SIGTERM 后给 10s 优雅停机
    wait_ready: true,
    listen_timeout: 30000,
  }],
}
EOF

sudo mkdir -p /var/log/kebaipay
sudo chown $USER:$USER /var/log/kebaipay

# 启动
cd /opt/kebaipay
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # 按提示执行输出的 sudo 命令
```

### 5.9 systemd 单元文件示例

如果不使用 PM2，可用 systemd 直接管理 node 进程：

```ini
# /etc/systemd/system/kebaipay.service
[Unit]
Description=KeBaiPay Application
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=simple
User=kebaipay
Group=kebaipay
WorkingDirectory=/opt/kebaipay
EnvironmentFile=/opt/kebaipay/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15

# 资源限制
LimitNOFILE=65535
MemoryMax=2G

# 输出到 journald
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kebaipay

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /bin/false -d /opt/kebaipay kebaipay
sudo chown -R kebaipay:kebaipay /opt/kebaipay

sudo systemctl daemon-reload
sudo systemctl enable --now kebaipay
sudo systemctl status kebaipay
sudo journalctl -u kebaipay -f
```

### 5.10 Nginx 配置（裸机模式）

裸机模式下 Nginx 配置与 [4.7 节](#47-配置-nginx-反向代理--https) 完全一致，upstream 指向 `127.0.0.1:3000` 即可。

---

## 6. Kubernetes 部署

### 6.1 Deployment YAML

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kebaipay
  namespace: kebaipay
  labels:
    app: kebaipay
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: kebaipay
  template:
    metadata:
      labels:
        app: kebaipay
    spec:
      containers:
        - name: app
          image: registry.cn-hangzhou.aliyuncs.com/your-registry/kebaipay:2.0.0
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: kebaipay-config
            - secretRef:
                name: kebaipay-secret
          resources:
            requests:
              cpu: '250m'
              memory: '512Mi'
            limits:
              cpu: '1000m'
              memory: '1Gi'
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ['/bin/sh', '-c', 'sleep 10']
      terminationGracePeriodSeconds: 30
```

### 6.2 Service + Ingress

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: kebaipay
  namespace: kebaipay
spec:
  selector:
    app: kebaipay
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kebaipay
  namespace: kebaipay
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
    nginx.ingress.kubernetes.io/proxy-body-size: '2m'
    nginx.ingress.kubernetes.io/proxy-read-timeout: '60'
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
spec:
  tls:
    - hosts: [api.your-domain.com]
      secretName: kebaipay-tls
  rules:
    - host: api.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kebaipay
                port:
                  number: 80
```

### 6.3 ConfigMap + Secret

```yaml
# k8s/config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kebaipay-config
  namespace: kebaipay
data:
  NODE_ENV: 'production'
  PORT: '3000'
  DATABASE_URL: 'postgresql://kebaipay@kebaipay-pg:5432/kebaipay?schema=public'
  REDIS_URL: 'redis://kebaipay-redis:6379'
  CORS_ORIGINS: 'https://your-domain.com'
  RECHARGE_NOTIFY_URL: 'https://api.your-domain.com/webhooks/recharge'
  CASHIER_BASE_URL: 'https://pay.your-domain.com'
  SMS_PROVIDER: 'aliyun'
  OTEL_SERVICE_NAME: 'kebaipay'
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector.observability:4318'
---
# k8s/secret.yaml（务必用 kubectl create secret 生成，勿提交明文）
apiVersion: v1
kind: Secret
metadata:
  name: kebaipay-secret
  namespace: kebaipay
type: Opaque
stringData:
  POSTGRES_PASSWORD: 'your-strong-postgres-password-2026'
  JWT_USER_SECRET: 'your-user-jwt-secret-32chars-2026-AbCdEf'
  JWT_ADMIN_SECRET: 'your-admin-jwt-secret-32chars-2026-XyZ123'
  ADMIN_DEFAULT_PASSWORD: 'ChangeAdmin2026'
  ENCRYPTION_KEY: 'your-aes-256-encryption-key-32chars-2026'
  REDIS_PASSWORD: 'your-redis-password-2026'
```

```bash
# 推荐：用 kubectl create secret 而不是提交 yaml
kubectl create secret generic kebaipay-secret \
  --namespace=kebaipay \
  --from-literal=POSTGRES_PASSWORD='your-strong-postgres-password-2026' \
  --from-literal=JWT_USER_SECRET='your-user-jwt-secret-32chars-2026-AbCdEf' \
  --from-literal=JWT_ADMIN_SECRET='your-admin-jwt-secret-32chars-2026-XyZ123' \
  --from-literal=ADMIN_DEFAULT_PASSWORD='ChangeAdmin2026' \
  --from-literal=ENCRYPTION_KEY='your-aes-256-encryption-key-32chars-2026' \
  --from-literal=REDIS_PASSWORD='your-redis-password-2026'
```

### 6.4 Liveness / Readiness 端点

| 探针 | 端点 | 失败阈值 | 行为 |
|------|------|---------|------|
| liveness | `/health` | 3 次 | 重启 Pod |
| readiness | `/health/ready` | 3 次 | 摘除流量，不重启 |

`/health/ready` 会检查 PostgreSQL 与 Redis 连接，DB/Redis 故障时返回 503，自动从 Service 摘除。

---

## 7. 升级与迁移流程

### 7.1 数据库迁移

#### 部署迁移（生产推荐）

```bash
# Docker Compose
docker compose exec app npx prisma migrate deploy
# 或镜像 entrypoint 已自动执行

# 裸机
npm run migrate:deploy

# 查看迁移状态
npm run migrate:status
```

#### 创建迁移（仅开发环境）

```bash
npm run migrate:dev -- --name add_new_table
```

#### 回滚迁移（不可逆警告）

> **⚠️ 警告：Prisma 不支持自动 down 迁移**。回滚方式：
> 1. 编写反向 SQL 手工执行（高风险，可能丢数据）
> 2. 从备份恢复数据库（推荐）

```bash
# 强制将某次迁移标记为已回滚（仅修复 _prisma_migrations 表，不撤销 schema 变更）
npx prisma migrate resolve --rolled-back 20260721180000_add_invoices

# 完整恢复（推荐）
gunzip -c /data/backups/kebaipay-YYYYMMDD_HHMMSS.sql.gz | \
  psql -U kebaipay -d kebaipay
```

### 7.2 配置升级

#### v1.0 → v2.0 升级清单

| 类别 | 变更项 | 说明 |
|------|--------|------|
| **强制新增** | `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry trace 导出端点 |
| **强制新增** | `SENTRY_DSN` | Sentry 异常告警 DSN |
| **强制新增** | `DATABASE_CONNECTION_LIMIT` | 默认 5，多副本需调小 |
| **强制新增** | `DATABASE_STATEMENT_TIMEOUT_MS` | 默认 30000 |
| **强制新增** | `DATABASE_POOL_TIMEOUT_SEC` | 默认 10 |
| **变更** | `SMS_PROVIDER` | 生产环境禁止 `mock`，启动校验会拒绝 |
| **变更** | `RECHARGE_NOTIFY_URL` | 生产环境必须 https + 非 localhost |
| **新增** | `MOCK_CHANNEL_SECRET` | 仅开发环境 |

#### 升级步骤

```bash
# 1. 备份
./scripts/backup-db.sh

# 2. 拉新代码
cd /opt/kebaipay
git fetch && git checkout v2.0.0

# 3. 合并 .env.example 新增变量到 .env
diff -u .env .env.example

# 4. 重新构建启动（自动跑 migrate deploy）
docker compose up -d --build

# 5. 验证
curl https://api.your-domain.com/health/ready
```

---

## 8. 监控与日志

### 8.1 Prometheus 接入（/metrics）

应用默认暴露 `GET /metrics` 端点（prom-client 文本格式），无需额外配置。

**Prometheus 抓取配置**：

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'kebaipay'
    metrics_path: /metrics
    static_configs:
      - targets: ['app:3000']   # docker compose 模式
      # - targets: ['kebaipay.default.svc:80']  # k8s 模式
```

**关键指标**：
- `http_requests_total{status,method,route}` — HTTP 请求计数
- `http_request_duration_seconds_bucket` — 延迟直方图
- `nodejs_heap_size_total_bytes` — 堆内存
- `process_cpu_seconds_total` — CPU 使用

> 生产环境通过 Nginx 或网络策略限制 `/metrics` 仅内网访问，避免暴露运行时指标。

### 8.2 OpenTelemetry trace 接入

设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 后自动启用，对 `http/express/pg/ioredis` 自动埋点。

```bash
# .env
OTEL_SERVICE_NAME="kebaipay"
OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
# OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer xxx"   # 带鉴权的 collector
```

推荐后端：**Jaeger / Tempo / Grafana Alloy / Honeycomb / Datadog**（兼容 OTLP 协议）。

### 8.3 Sentry 异常告警

```bash
# .env
SENTRY_DSN="https://xxxxx@sentry.io/xxx"
```

未配置时不启用，零开销。配置后 `unhandledRejection` 与 `uncaughtException` 自动上报，包含完整 stack 与 traceId。

### 8.4 日志聚合

- **格式**：生产环境默认 JSON 结构化日志（`JsonLogger`），每条日志自带 `traceId` 字段。
- **采集**：Filebeat / Promtail 读取 PM2 / docker 日志文件，发送到 ELK / Loki。
- **Trace 关联**：日志中的 `traceId` 与 OpenTelemetry span 一致，可在 Jaeger/Tempo 中点击 traceId 跳转到对应日志。

**Loki Promtail 配置示例**：

```yaml
# promtail.yml
scrape_configs:
  - job_name: kebaipay-docker
    docker_sd_configs:
      - hosts: ['unix:///var/run/docker.sock']
        filters:
          - containers: ['kebaipay-app']
    pipeline_stages:
      - json:
          expressions:
            level: level
            traceId: traceId
            msg: msg
      - labels:
          level:
          traceId:
```

### 8.5 健康检查端点

| 端点 | 用途 | 检查内容 |
|------|------|---------|
| `GET /health` | liveness 探针 | 进程存活 |
| `GET /health/ready` | readiness 探针 | DB + Redis 连接，故障返回 503 |
| `GET /health/schedules` | 调度任务状态 | 定时任务上次执行时间与状态 |
| `GET /health/channels` | 支付渠道健康 | 微信/支付宝/mock 渠道连通性 |
| `GET /health/channels/summary` | 渠道健康摘要 | 汇总状态 |
| `GET /metrics` | Prometheus 指标 | 文本格式指标 |

```bash
curl https://api.your-domain.com/health
curl https://api.your-domain.com/health/ready
curl https://api.your-domain.com/health/channels
```

---

## 9. 性能调优

### 9.1 PostgreSQL 连接池调优

`.env` 中以下三个变量控制连接池（`@prisma/adapter-pg`）：

| 变量 | 默认值 | 建议值（按副本数） | 说明 |
|------|--------|------------------|------|
| `DATABASE_CONNECTION_LIMIT` | 5 | `PG max_connections / 副本数 - 2` | 单进程最大连接数 |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 30000 | 30000 | 单条 SQL 执行超时（毫秒），防慢查询挂死连接 |
| `DATABASE_POOL_TIMEOUT_SEC` | 10 | 10 | 获取连接超时（秒），快速失败 |

**多副本部署计算示例**：

```text
PG max_connections = 200
副本数 = 4
每副本 Node 进程数 = 1（cluster 模式 4 进程则按 4 算）

DATABASE_CONNECTION_LIMIT = (200 - 系统预留 20) / (4 副本 × 4 进程) = 11
向下取整设为 10
```

**PostgreSQL 服务端调优**（`postgresql.conf`）：

```conf
max_connections = 200
shared_buffers = 2GB              # 25% 内存
effective_cache_size = 6GB        # 75% 内存
work_mem = 16MB
maintenance_work_mem = 256MB
random_page_cost = 1.1            # SSD
checkpoint_completion_target = 0.9
wal_buffers = 16MB
```

### 9.2 Redis 连接

`ioredis` 默认单连接复用，无需特殊配置。生产建议：

```conf
# /etc/redis/redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
timeout 300
tcp-keepalive 60
```

监控指标：
- `connected_clients` — 当前连接数
- `used_memory_rss` — 实际占用内存
- `rejected_connections` — 拒绝数（应恒为 0）

### 9.3 Node.js 进程

#### PM2 cluster 模式

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kebaipay',
    script: 'dist/main.js',
    instances: 'max',                       // = CPU 核数
    exec_mode: 'cluster',
    node_args: '--max-old-space-size=1024', // 堆内存上限 1G
    max_memory_restart: '1G',               // 超过 1G 自动重启
    // ...
  }],
}
```

#### K8s 资源限制

```yaml
resources:
  requests:
    cpu: '250m'
    memory: '512Mi'
  limits:
    cpu: '1000m'
    memory: '1Gi'
```

#### --max-old-space-size 经验值

| 容器内存 | 建议 max-old-space-size |
|---------|------------------------|
| 512MB | 384 |
| 1GB | 768 |
| 2GB | 1536 |
| 4GB | 3072 |

> 留约 25% 内存给 native 模块（bcrypt）、Buffer、V8 overhead。

### 9.4 限流配置

`app.module.ts` 中已硬编码三档 Throttler 配置：

| 名称 | TTL | Limit | 适用场景 |
|------|-----|-------|---------|
| `default` | 60s | 100 | 全局默认（未指定 `@Throttle` 的接口） |
| `auth` | 60s | 10 | 登录 / 注册 / 发送验证码 |
| `open-api` | 60s | 30 | 开放 API（HMAC 签名接口） |

如需覆盖默认值，在 `.env` 中添加（需修改源码读取，当前为硬编码）：

```bash
# 当前版本硬编码，未来可扩展为：
# THROTTLER_TTL=60000
# THROTTLER_LIMIT=100
```

> 健康检查 `/health/*` 与 `/metrics` 已加 `@SkipThrottle()`，不受限流。

---

## 10. 安全加固 Checklist

部署到生产前**逐项确认**：

- [ ] **6 个 secret 全部改成强密钥**（`POSTGRES_PASSWORD` / `JWT_USER_SECRET` / `JWT_ADMIN_SECRET` / `ADMIN_DEFAULT_PASSWORD` / `ENCRYPTION_KEY` / `REDIS_PASSWORD`）
- [ ] `CORS_ORIGINS` 改成生产域名（不含 localhost）
- [ ] `RECHARGE_NOTIFY_URL` 改成 `https://` 开头且外网可访问
- [ ] Nginx 启用 HSTS、TLS 1.2+（禁用 TLS 1.0/1.1、SSLv3）
- [ ] **mock 渠道禁用**（生产环境 `PaymentChannelRegistry` 会拒绝降级到 mock）
- [ ] `SMS_PROVIDER` 改成 `aliyun` / `tencent` / `huawei`（生产环境禁止 `mock`）
- [ ] **数据库定时备份**已配置（crontab 每天 3 点，保留 30 天）
- [ ] Redis 启用密码（`requirepass`）+ `appendonly` 持久化
- [ ] 防火墙只开放 80/443，PostgreSQL(5432) / Redis(6379) 仅本机访问
- [ ] 启用 OpenTelemetry（`OTEL_EXPORTER_OTLP_ENDPOINT`）+ Sentry（`SENTRY_DSN`）

**附加建议**：
- [ ] 启用 fail2ban 防 SSH 暴力破解
- [ ] 管理员账号启用 2FA（如已实现）
- [ ] 定期轮换 JWT 密钥（建议每季度）
- [ ] 监控异常登录、大额提现等风控事件

---

## 11. 故障恢复

### 11.1 数据库恢复

```bash
# 1. 停止应用（避免恢复期间有写入）
docker compose stop app
# 或裸机：pm2 stop kebaipay

# 2. 恢复数据库
gunzip -c /data/backups/kebaipay_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose exec -T postgres psql -U postgres -d kebaipay

# 3. 重启应用
docker compose start app
# 或裸机：pm2 start kebaipay

# 4. 验证
curl http://localhost:3000/health/ready
```

### 11.2 Redis 故障应对

**症状**：`/health/ready` 返回 503，日志中出现 `ioredis` 连接错误。

**影响**：
- 分布式锁失效 → 并发资金操作可能不一致
- nonce 防重放开放 → 开放 API 可被重放
- 滑动窗口限流失效 → 退化为单进程计数

**应急步骤**：

```bash
# 1. 检查 Redis 进程
docker compose ps redis
redis-cli -a your-redis-password-2026 ping

# 2. 查看 Redis 日志
docker compose logs --tail 100 redis

# 3. 如进程崩溃，重启
docker compose restart redis

# 4. 如数据损坏，清空数据卷重建（数据可丢失，仅 nonce/锁/限流）
docker compose down redis
docker volume rm kebaipay_redis_data
docker compose up -d redis

# 5. 等应用自动重连（ioredis 自带重连）
docker compose logs -f app | grep -i redis
```

> 资金操作必须依赖 Redis 分布式锁，Redis 故障期间应**暂停提现/转账接口**或降级到只读模式。

### 11.3 应用崩溃自动拉起

| 部署方式 | 拉起机制 | 配置 |
|---------|---------|------|
| Docker Compose | `restart: unless-stopped` | `docker-compose.yml` 已配置 |
| PM2 | 自动重启 + 开机自启 | `pm2 startup && pm2 save` |
| systemd | `Restart=always` | `kebaipay.service` 已配置 |
| K8s | Deployment controller | `livenessProbe` 失败自动重启 Pod |

**进程级异常兜底**：`main.ts` 已注册 `unhandledRejection` / `uncaughtException` 钩子，记录日志后 `process.exit(1)`，由上层编排器拉起新实例，避免进程进入未定义状态导致资金数据错乱。

---

## 12. 运维命令速查

### 12.1 Docker Compose

```bash
# 启停
docker compose up -d --build              # 构建并后台启动
docker compose start                      # 启动已停止的容器
docker compose stop                       # 停止（保留容器）
docker compose restart app                # 重启 app
docker compose down                       # 停止并删除容器（保留数据卷）
docker compose down -v                    # 停止并删除数据卷（危险！）

# 查看
docker compose ps                         # 容器状态
docker compose logs -f app                # 实时日志
docker compose logs --tail 200 app        # 最近 200 行
docker compose top app                    # 容器内进程

# 进入容器
docker compose exec app sh                # 进入 app 容器
docker compose exec postgres psql -U postgres -d kebaipay   # 进入 psql

# 资源监控
docker stats kebaipay-app kebaipay-postgres kebaipay-redis
```

### 12.2 psql

```bash
# 连接
psql -U kebaipay -d kebaipay -h localhost
# 或：docker compose exec postgres psql -U postgres -d kebaipay

# 常用查询
\dt                                       # 列出所有表
\dn                                       # 列出 schema
\dx                                       # 列出扩展
\du                                       # 列出用户
SELECT * FROM "_prisma_migrations";       # 查看迁移历史
SELECT count(*) FROM "AdminUser";         # 管理员数量
SELECT count(*) FROM "User";              # 用户数量
SELECT pg_size_pretty(pg_database_size('kebaipay'));   # 数据库大小
SELECT * FROM pg_stat_activity;           # 当前连接与查询

# 备份恢复
pg_dump -U kebaipay -d kebaipay | gzip > backup.sql.gz
gunzip -c backup.sql.gz | psql -U kebaipay -d kebaipay
```

### 12.3 redis-cli

```bash
# 连接
redis-cli -a your-redis-password-2026

# 常用命令
PING                                      # 连通性
INFO                                      # 服务器信息
INFO memory                               # 内存详情
DBSIZE                                    # key 数量
CLIENT LIST                               # 连接列表
MONITOR                                   # 实时命令（调试用，生产慎用）
KEYS *                                    # 列出所有 key（生产禁用，用 SCAN）
SCAN 0 COUNT 100                          # 增量遍历
FLUSHDB                                   # 清空当前库（危险！）

# 慢日志
SLOWLOG GET 10
CONFIG GET slowlog-log-slower-than
```

### 12.4 PM2

```bash
pm2 list                                  # 进程列表
pm2 status                                # 状态
pm2 monit                                 # 实时监控面板
pm2 logs kebaipay                         # 实时日志
pm2 logs kebaipay --lines 200             # 最近 200 行
pm2 restart kebaipay                      # 重启
pm2 reload kebaipay                       # 零停机重启（cluster 模式）
pm2 stop kebaipay                         # 停止
pm2 delete kebaipay                       # 删除
pm2 describe kebaipay                     # 详细信息
pm2 startup                               # 开机自启
pm2 save                                  # 保存进程列表

# 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### 12.5 kubectl

```bash
# 资源查看
kubectl get pods -n kebaipay
kubectl get deploy,svc,ingress -n kebaipay
kubectl describe pod -n kebaipay -l app=kebaipay

# 日志
kubectl logs -n kebaipay -l app=kebaipay --tail=200
kubectl logs -n kebaipay -l app=kebaipay -f
kubectl logs -n kebaipay <pod-name> --previous    # 上次崩溃的日志

# 进入 Pod
kubectl exec -n kebaipay -it <pod-name> -- sh

# 扩缩容
kubectl scale deploy/kebaipay -n kebaipay --replicas=5

# 滚动重启
kubectl rollout restart deploy/kebaipay -n kebaipay
kubectl rollout status deploy/kebaipay -n kebaipay
kubectl rollout undo deploy/kebaipay -n kebaipay   # 回滚到上一版本

# 迁移
kubectl exec -n kebaipay <pod-name> -- npx prisma migrate deploy
kubectl exec -n kebaipay <pod-name> -- npx prisma db seed
```

### 12.6 Nginx

```bash
sudo nginx -t                              # 测试配置
sudo nginx -s reload                       # 重载配置
sudo systemctl reload nginx                # 同上（systemd）
sudo systemctl restart nginx               # 重启
sudo tail -f /var/log/nginx/kebaipay-api-access.log
sudo tail -f /var/log/nginx/kebaipay-api-error.log
```

### 12.7 Prisma

```bash
npm run db:generate                        # 生成 Client
npm run migrate:deploy                     # 部署迁移（生产）
npm run migrate:status                     # 迁移状态
npm run migrate:dev -- --name xxx          # 创建迁移（开发）
npm run migrate:resolve -- --rolled-back <name>   # 标记回滚
npm run db:seed                            # 初始化 seed
npm run db:studio                          # Prisma Studio GUI
```

### 12.8 健康检查与诊断

```bash
# 健康端点
curl -s https://api.your-domain.com/health         | jq
curl -s https://api.your-domain.com/health/ready   | jq
curl -s https://api.your-domain.com/health/schedules | jq
curl -s https://api.your-domain.com/health/channels  | jq

# 指标
curl -s https://api.your-domain.com/metrics | head -50

# 端口连通性
telnet your-domain.com 443
nc -zv your-domain.com 443

# TLS 证书
echo | openssl s_client -connect api.your-domain.com:443 -servername api.your-domain.com 2>/dev/null | openssl x509 -noout -dates -subject
```

---

## 附录：常见问题速查

| 现象 | 排查方向 |
|------|---------|
| 启动报 `生产环境安全校验失败` | 6 个 secret 未改 / `CORS_ORIGINS` 缺失 / `RECHARGE_NOTIFY_URL` 是 localhost |
| 启动报 `DATABASE_URL 未配置` | `.env` 未加载 / 文件路径错误 / docker-compose 缺少环境变量 |
| `/health/ready` 返回 503 | PostgreSQL 或 Redis 连接失败，查 `docker compose ps` |
| 502 Bad Gateway | Nginx upstream 配置错 / app 未启动 / 端口被占用 |
| 充值订单卡 PENDING | `RECHARGE_NOTIFY_URL` 指向 localhost / 渠道配置缺失 / 回调签名失败 |
| 跨域请求被拒 | `CORS_ORIGINS` 未包含前端域名 |
| 生产环境看到 Swagger | `NODE_ENV` 未设为 `production` |
| 限流 429 | 触发 Throttler，调整接口频率或扩展 `@Throttle` 装饰器 |
| 连接数耗尽 | `DATABASE_CONNECTION_LIMIT` 过大 / 副本数 × 进程数 > PG `max_connections` |

更多问题详见 [`docs/TROUBLESHOOT.md`](./TROUBLESHOOT.md)。
