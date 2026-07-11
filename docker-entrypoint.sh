#!/bin/sh
set -e

echo "[entrypoint] Starting KeBaiPay..."

# 如果配置了 PostgreSQL，跑 migration
# docker-compose 的 depends_on: service_healthy 已经保证 PG ready，
# 这里再加简单重试防止极端情况（如 PG 容器刚起来还没完全 ready）
if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -q "^postgres"; then
  echo "[entrypoint] Running prisma migrate deploy..."
  for i in 1 2 3 4 5; do
    if npx prisma migrate deploy; then
      echo "[entrypoint] Migration succeeded."
      break
    fi
    if [ "$i" -eq 5 ]; then
      echo "[entrypoint] Migration failed after 5 attempts, giving up."
      exit 1
    fi
    echo "[entrypoint] Migration attempt $i failed, retrying in 3s..."
    sleep 3
  done
fi

echo "[entrypoint] Launching app as user nestjs..."
exec su-exec nestjs "$@"
