#!/bin/bash
echo "========================================"
echo "  科佰支付 KeBaiPay - 启动脚本"
echo "========================================"
echo

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到Node.js，请先安装Node.js（>= 20.0.0）"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

echo "[1/5] 检查Node.js版本..."
node -v
echo

echo "[2/5] 安装依赖..."
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi
if [ $? -ne 0 ]; then
    echo "[错误] 依赖安装失败"
    exit 1
fi
echo

echo "[3/5] 生成Prisma客户端..."
npx prisma generate
echo

echo "[4/5] 执行数据库迁移..."
if [ -n "$DATABASE_URL" ]; then
    npx prisma migrate deploy
    if [ $? -ne 0 ]; then
        echo "[错误] 数据库迁移失败，请检查 DATABASE_URL 和 PostgreSQL 是否启动"
        exit 1
    fi
else
    echo "[警告] DATABASE_URL 未设置，跳过迁移。请确保 PostgreSQL 已启动并在 .env 中配置 DATABASE_URL。"
fi
echo

echo "[5/5] 构建项目..."
npx nest build
if [ $? -ne 0 ]; then
    echo "[错误] 构建失败"
    exit 1
fi
echo

echo "========================================"
echo "  构建完成！"
echo "========================================"
echo
echo "访问地址: http://localhost:3000"
echo "管理后台: http://localhost:3000/#adminLogin"
echo "API文档: http://localhost:3000/api/docs"
echo
echo "管理员账号: admin"
echo "管理员密码: 见 .env 中的 ADMIN_DEFAULT_PASSWORD"
echo
echo "首次部署需要执行 seed 创建管理员账号："
echo "  npm run db:seed"
echo
echo "按Enter键启动服务器..."
read

echo
echo "正在启动服务器..."
node dist/main.js
