const path = require('node:path')
const fs = require('node:fs')

// Prisma 7 的 prisma.config.js 不会自动加载 .env 文件，需手动加载。
// 仅在 .env 存在时加载（生产环境通常用容器注入的环境变量，无 .env 文件）
const envPath = path.join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath })
}

/**
 * Prisma 7 配置文件
 * - schema: 指向 schema.prisma
 * - datasource.url: migrate / introspection 命令用的数据库连接
 *   （运行时 PrismaClient 走 driver adapter，不读这个 url）
 *
 * 注意：env() 函数要求变量必须存在，否则启动失败。
 * 部署时确保 DATABASE_URL 已通过 docker-compose / k8s 注入。
 */
const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: env('DATABASE_URL'),
  },
})
