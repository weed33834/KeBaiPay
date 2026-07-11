# KeBaiPay 交付说明（请先看这个）

交付对象：测试人员 / 服务器部署人员  
版本：v1.0.0  
交付时间：2026-07-04

---

## 这个项目是什么

科佰支付 KeBaiPay，一个钱包 + 商户收款平台。前后端一体，NestJS 后端 + H5 静态页面同源部署，**不需要单独部署前端**。

技术栈：NestJS 11 + Prisma 7 + PostgreSQL 16 + Redis 7

---

## 测试账号（seed 后才有，看下面"初始化数据"）

### 管理员账号
```
登录入口：http://你的服务器IP:3000/#adminLogin
用户名：admin
密码：见 .env 里的 ADMIN_DEFAULT_PASSWORD（默认 LocalAdmin2026）
```

> 注意：管理员密码由 `.env` 里的 `ADMIN_DEFAULT_PASSWORD` 决定，部署前请改成自己的密码再 seed。

### 测试用户账号
```
登录入口：http://你的服务器IP:3000/#login
手机号：13900000011
登录密码：Abc12345
支付密码：123456
初始余额：10000 元（已实名认证）
```

---

## 最快部署方式（5 分钟搞定）

服务器装好 Docker 和 Docker Compose 后，按顺序执行：

```bash
# 1. 把整个项目目录传到服务器（scp/rsync 都行）
scp -r kebaipay root@你的服务器IP:/opt/
ssh root@你的服务器IP
cd /opt/kebaipay

# 2. 复制环境变量模板
cp .env.example .env

# 3. 编辑 .env，必须改掉这 6 个值（不改会拒绝启动）
vi .env
#   POSTGRES_PASSWORD        改成你自己的强密码
#   JWT_USER_SECRET          32位以上随机字符串
#   JWT_ADMIN_SECRET         另一个不同的32位随机字符串
#   ADMIN_DEFAULT_PASSWORD   管理员密码（8位以上含大小写+数字）
#   ENCRYPTION_KEY           32位以上随机字符串
#   REDIS_PASSWORD           Redis 密码

# 4. 一键启动（自动构建镜像 + 启动 PG + Redis + 应用）
docker compose up -d --build

# 5. 初始化管理员账号 + 测试用户
docker compose exec app npx prisma db seed

# 6. 验证
curl http://localhost:3000/health/ready
# 返回 {"status":"ok",...} 就是成功了
```

浏览器访问 `http://你的服务器IP:3000/` 看到首页即部署成功。

---

## 必须知道的几个关键点

1. **6 个密钥必须改**：`.env` 里 `POSTGRES_PASSWORD`、`JWT_USER_SECRET`、`JWT_ADMIN_SECRET`、`ADMIN_DEFAULT_PASSWORD`、`ENCRYPTION_KEY`、`REDIS_PASSWORD` 留默认值会被 `SecurityValidatorService` 直接拒绝启动，看日志会看到 `[FATAL] Security validation failed`。

2. **生产环境必须配 CORS_ORIGINS**：改成你的真实域名，例如 `https://pay.yourdomain.com`，否则启动也会被拦。

3. **seed 命令只在首次部署跑一次**：以后重启不需要再 seed。如果忘了管理员密码，看 README 第六节"常见错误对照表"。

4. **首次启动后管理员账号才存在**：跑完 `prisma db seed` 才能用 `admin` 登录。

5. ** Swagger 文档生产环境关闭**：`/api/docs` 在 `NODE_ENV=production` 下打不开是正常的，本地开发才能访问。

---

## 详细文档

**所有部署细节、错误排查、运维命令、Nginx 配置都在 `README.md` 里**，遇到问题先看 README 第六节"常见错误对照表"，列了 10 类常见报错和解决方法。

---

## 项目目录主要文件说明

| 文件/目录 | 说明 |
|----------|------|
| `README.md` | **必看**，完整部署文档 + 错误排查 |
| `.env.example` | 环境变量模板，部署时复制为 `.env` |
| `docker-compose.yml` | 生产环境 Docker 编排 |
| `docker-compose.dev.yml` | 开发环境（只起 PG + Redis） |
| `Dockerfile` | 应用镜像构建脚本 |
| `package.json` | 依赖和脚本 |
| `prisma/` | 数据库 schema + migrations + seed |
| `src/` | 后端源码 |
| `public/` | H5 前端源码 |
| `docs/` | 各类详细文档（API/管理后台/商户接入等） |
| `start.sh` / `start.bat` | 裸机部署启动脚本（不用 Docker 时用） |

---

## 联系方式

部署遇到问题，先看 README 错误对照表。如果对照表解决不了，把以下信息一起发过来：
1. `docker compose logs app` 的完整输出
2. `docker compose ps` 的结果
3. `.env` 里的配置（**密钥用 `***` 替换，不要发真实密钥**）
