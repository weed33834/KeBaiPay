# KeBaiPay 部署指南

> 生产环境部署、配置与运维清单

## 目录

- [环境要求](#环境要求)
- [环境变量](#环境变量)
- [数据库配置](#数据库配置)
- [Redis 配置](#redis-配置)
- [Docker 部署](#docker-部署)
- [PM2 部署](#pm2-部署)
- [Nginx 配置](#nginx-配置)
- [SSL 配置](#ssl-配置)
- [监控配置](#监控配置)
- [生产检查清单](#生产检查清单)
- [备份策略](#备份策略)
- [常见问题](#常见问题)

---

## 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 20 | NestJS 11 + TypeScript 6 要求 |
| PostgreSQL | >= 16 | 不再支持 SQLite |
| Redis | >= 7 | 生产环境必填，nonce 防重放 + 分布式锁 |
| Docker | >= 20.10 | 可选，用于容器化部署 |
| Nginx | >= 1.20 | 反向代理（推荐） |

---

## 环境变量

创建 `.env` 文件（参考 `.env.example`）：

```bash
# ===== 数据库 =====
DATABASE_URL="postgresql://postgres:password@localhost:5432/kebaipay?schema=public"

# ===== Redis =====
REDIS_URL="redis://localhost:6379"
REDIS_PASSWORD="your_redis_password"

# ===== JWT 密钥（必须修改！） =====
JWT_USER_SECRET="change-this-to-a-strong-random-string"
JWT_ADMIN_SECRET="change-this-to-another-strong-random-string"

# ===== 管理员默认密码（必须修改！） =====
ADMIN_DEFAULT_PASSWORD="change-this-in-production"

# ===== 加密密钥（必须修改！） =====
ENCRYPTION_KEY="change-this-to-32-char-key"

# ===== 应用配置 =====
PORT=3000
NODE_ENV="production"
CORS_ORIGINS="https://your-domain.com"

# ===== 业务配置 =====
RECHARGE_NOTIFY_URL="https://api.your-domain.com/webhooks/recharge"
CASHIER_BASE_URL="https://pay.your-domain.com"
```

### 环境变量说明

| 变量名 | 必填 | 说明 |
|--------|------|------|
| DATABASE_URL | 是 | 数据库连接字符串 |
| REDIS_URL | 否 | Redis 连接地址（不配置则降级为进程内缓存） |
| REDIS_PASSWORD | 否 | Redis 密码 |
| JWT_USER_SECRET | 是 | 用户 JWT 签名密钥 |
| JWT_ADMIN_SECRET | 是 | 管理员 JWT 签名密钥 |
| ADMIN_DEFAULT_PASSWORD | 是 | 管理员默认密码 |
| ENCRYPTION_KEY | 是 | 敏感数据加密密钥（32 字符） |
| PORT | 否 | 服务端口，默认 3000 |
| NODE_ENV | 是 | 运行环境：development / production |
| CORS_ORIGINS | 否 | 允许的跨域来源（逗号分隔） |
| RECHARGE_NOTIFY_URL | 否 | 充值回调通知地址 |
| CASHIER_BASE_URL | 是 | 收银台前端地址 |

---

## 数据库配置

### PostgreSQL（推荐）

```bash
# 1. 创建数据库
psql -U postgres -c "CREATE DATABASE kebaipay;"

# 2. 运行迁移
npm run migrate:deploy

# 3. 生成 Prisma Client
npm run db:generate
```

### SQLite（开发环境）

```bash
# 直接推送 schema
npm run db:push
```

### 数据库迁移

```bash
# 开发环境：创建迁移
npm run migrate:dev

# 生产环境：部署迁移
npm run migrate:deploy

# 查看迁移状态
npm run migrate:status
```

---

## Redis 配置

Redis 用于：
- **nonce 防重放**：防止开放 API 请求重放
- **分布式锁**：资金操作并发控制
- **频率限制**：API 调用频率统计

### Redis 部署建议

```bash
# Docker 启动 Redis
docker run -d \
  --name kebaipay-redis \
  -p 6379:6379 \
  -e REDIS_PASSWORD=your_password \
  redis:7-alpine redis-server --requirepass your_password
```

### Redis 降级机制

如果未配置 Redis，系统会自动降级：
- nonce 防重放降级为进程内 Map（仅单实例有效）
- 分布式锁降级为无锁模式

> 生产环境强烈建议配置 Redis。

---

## Docker 部署

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["npm", "run", "start:prod"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/kebaipay
      - REDIS_URL=redis://redis:6379
      - REDIS_PASSWORD=your_redis_password
      - JWT_USER_SECRET=your_jwt_user_secret
      - JWT_ADMIN_SECRET=your_jwt_admin_secret
      - ADMIN_DEFAULT_PASSWORD=your_admin_password
      - ENCRYPTION_KEY=your_32_char_encryption_key
      - CORS_ORIGINS=https://your-domain.com
      - CASHIER_BASE_URL=https://pay.your-domain.com
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=kebaipay
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass your_redis_password
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### 启动命令

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f app

# 停止服务
docker-compose down

# 重建镜像
docker-compose up -d --build
```

---

## PM2 部署

### 安装 PM2

```bash
npm install -g pm2
```

### 部署脚本

```bash
#!/bin/bash
# deploy.sh

# 1. 安装依赖
npm ci --production

# 2. 构建
npm run build

# 3. 运行迁移
npm run migrate:deploy

# 4. 启动应用
pm2 start dist/main.js --name kebaipay -i max

# 5. 保存进程列表
pm2 save

# 6. 开机自启
pm2 startup
```

### PM2 配置文件

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kebaipay',
    script: 'dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
  }]
}
```

### PM2 常用命令

```bash
pm2 status              # 查看状态
pm2 logs kebaipay       # 查看日志
pm2 restart kebaipay    # 重启应用
pm2 stop kebaipay       # 停止应用
pm2 delete kebaipay     # 删除应用
pm2 monit               # 监控面板
```

---

## Nginx 配置

### 基础配置

```nginx
upstream kebaipay {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    # SSL 配置
    ssl_certificate /etc/nginx/ssl/your-domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 日志
    access_log /var/log/nginx/kebaipay-access.log;
    error_log /var/log/nginx/kebaipay-error.log;

    # 代理配置
    location / {
        proxy_pass http://kebaipay;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        proxy_pass http://kebaipay;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 健康检查
    location /health {
        proxy_pass http://kebaipay;
        access_log off;
    }
}
```

### 收银台前端配置

```nginx
server {
    listen 443 ssl http2;
    server_name pay.your-domain.com;

    ssl_certificate /etc/nginx/ssl/your-domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;

    root /var/www/kebaipay-cashier;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://kebaipay;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 重载 Nginx

```bash
nginx -t                    # 测试配置
nginx -s reload             # 重载配置
systemctl reload nginx      # 或使用 systemctl
```

---

## SSL 配置

### 使用 Let's Encrypt（推荐）

```bash
# 安装 certbot
apt install certbot python3-certbot-nginx

# 获取证书
certbot --nginx -d api.your-domain.com -d pay.your-domain.com

# 自动续期
certbot renew --dry-run
```

### 手动配置

```bash
# 生成自签名证书（开发环境）
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/your-domain.key \
  -out /etc/nginx/ssl/your-domain.crt \
  -subj "/C=CN/ST=Beijing/L=Beijing/O=KeBaiPay/CN=api.your-domain.com"
```

---

## 监控配置

### 健康检查端点

```bash
# 存活探针
curl http://localhost:3000/health

# 就绪探针
curl http://localhost:3000/health/ready

# 调度任务状态
curl http://localhost:3000/health/schedules

# 支付渠道状态
curl http://localhost:3000/health/channels
```

### Prometheus + Grafana

```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

volumes:
  prometheus_data:
  grafana_data:
```

### Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'kebaipay'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/health'
```

### 日志监控

```bash
# PM2 日志配置
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### 告警规则

```yaml
# alertmanager.yml
groups:
  - name: kebaipay
    rules:
      - alert: ServiceDown
        expr: up{job="kebaipay"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "KeBaiPay service is down"

      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
```

---

## 生产检查清单

### 安全配置

- [ ] 已修改 `JWT_USER_SECRET`（使用强随机字符串）
- [ ] 已修改 `JWT_ADMIN_SECRET`（使用不同的强随机字符串）
- [ ] 已修改 `ADMIN_DEFAULT_PASSWORD`
- [ ] 已修改 `ENCRYPTION_KEY`（32 字符）
- [ ] 已配置 `CORS_ORIGINS`（仅允许的域名）
- [ ] 已启用 HTTPS（通过 Nginx 反向代理）
- [ ] 已配置防火墙规则

### 数据库

- [ ] 已创建生产数据库
- [ ] 已运行 `migrate:deploy`
- [ ] 已配置数据库备份策略
- [ ] 数据库连接池配置合理

### Redis

- [ ] 已配置 Redis 密码
- [ ] 已配置 Redis 持久化
- [ ] Redis 内存限制合理

### 应用配置

- [ ] `NODE_ENV=production`
- [ ] Swagger 文档未在生产环境暴露
- [ ] 日志级别配置合理
- [ ] 已配置日志轮转

### 监控

- [ ] 健康检查端点正常
- [ ] 已配置应用监控（Prometheus/Grafana）
- [ ] 已配置告警规则
- [ ] 已配置日志收集

---

## 备份策略

### 数据库备份

```bash
# 每日备份
pg_dump -U postgres kebaipay > backup_$(date +%Y%m%d).sql

# 恢复
psql -U postgres kebaipay < backup_20240101.sql
```

### 自动备份脚本

```bash
#!/bin/bash
# /etc/cron.daily/kebaipay-backup

BACKUP_DIR="/backups/kebaipay"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
pg_dump -U postgres kebaipay | gzip > $BACKUP_DIR/kebaipay_$DATE.sql.gz

# 保留 30 天
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
```

---

## 常见问题

### 1. 启动时报 "Insecure defaults"

**原因**：生产环境使用了默认密钥。

**解决**：修改 `.env` 中的 `JWT_USER_SECRET`、`JWT_ADMIN_SECRET`、`ENCRYPTION_KEY`。

### 2. 数据库连接失败

**检查**：
- `DATABASE_URL` 格式是否正确
- 数据库服务是否启动
- 数据库用户权限是否正确

### 3. Redis 连接失败

**影响**：
- nonce 防重放降级为进程内缓存
- 分布式锁降级为无锁模式

**解决**：检查 `REDIS_URL` 和 `REDIS_PASSWORD`。

### 4. 跨域请求被拒绝

**解决**：在 `CORS_ORIGINS` 中添加前端域名。

### 5. 生产环境能看到 Swagger 文档

**原因**：`NODE_ENV` 未设置为 `production`。

**解决**：确认 `.env` 中 `NODE_ENV="production"`。

### 6. 502 Bad Gateway

**检查**：
- Nginx upstream 配置是否正确
- 应用服务是否正常运行
- 端口是否被占用

### 7. SSL 证书错误

**检查**：
- 证书文件路径是否正确
- 证书是否过期
- 证书域名是否匹配
