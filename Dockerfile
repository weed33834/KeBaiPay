# ===========================================================================
# KeBaiPay Dockerfile (multi-stage)
#
# 策略：
#   builder 阶段装全部依赖（含 dev），编译 native 模块（bcrypt 等），
#   跑 prisma generate，编译 TS。
#   runner 阶段不重新 npm ci，直接拷贝 builder 的 node_modules（已含编译产物），
#   避免在 alpine runner 里装 python/make/g++ 工具链。
#
# 运行时：
#   - 以 root 启动 entrypoint，跑 prisma migrate deploy，
#     然后 su-exec 切到 nestjs 非 root 用户启动 node。
#   - tini 做 PID 1，正确转发信号（SIGTERM 等）。
# ===========================================================================

# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# native 模块（bcrypt）需要构建工具
RUN apk add --no-cache python3 make g++

# 先拷依赖描述文件（利用 docker 层缓存）
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.js ./

# 装全部依赖（包括 dev，因为 build 需要 typescript/nest-cli）
# --ignore-scripts 跳过 postinstall（prisma generate 下面单独跑）
RUN npm ci --ignore-scripts

# 生成 Prisma Client（WASM engine，不需要 native engine 二进制）
# 注意：prisma.config.js 使用 env('DATABASE_URL')，generate 不连数据库但加载配置时需要变量存在
# 设一个占位值即可，运行时由 docker-compose 注入真实地址
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
RUN npx prisma generate

# 拷源代码并编译
COPY . .
RUN npm run build

# ---------- 生产阶段 ----------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 运行时需要的包：
#   ca-certificates  - HTTPS 调用微信/支付宝等需要根证书
#   tini             - PID 1，正确转发信号，防止僵尸进程
#   su-exec          - entrypoint 里从 root 切到非 root 用户
#   wget             - HEALTHCHECK 用（busybox wget 不支持 -qO- 合并写法）
RUN apk add --no-cache ca-certificates tini su-exec wget \
  && update-ca-certificates

# 直接拷贝 builder 的 node_modules（含已编译的 native 模块 + prisma CLI + WASM engine）
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.js ./prisma.config.js
COPY --from=builder /app/public ./public

# entrypoint（root 运行，用来 migrate + 降权）
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# 健康检查（用 wget，已在上面 apk add；grep "ok" 确保拿到正确响应）
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- --timeout=3 http://localhost:3000/health/ready | grep -q "ok" || exit 1

# 非 root 用户
RUN addgroup -g 1001 -S nodejs \
  && adduser -S nestjs -u 1001 -G nodejs -h /home/nestjs \
  && mkdir -p /home/nestjs/.cache \
  && chown -R nestjs:nodejs /app /home/nestjs

# 注意：不在这里 USER nestjs，entrypoint 以 root 启动，
# 跑完 migrate deploy 后再 su-exec 切到 nestjs。

# tini 做 PID 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
