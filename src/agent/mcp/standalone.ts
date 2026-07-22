/**
 * KeBaiPay MCP Server 独立启动入口
 *
 * 用途：让外部 AI Agent（如 Claude Desktop / Cursor / Trae）通过 MCP 协议调用 KeBaiPay。
 *
 * 启动方式：
 *   node dist/agent/mcp/standalone.js
 *
 * Claude Desktop 配置示例（~/Library/Application Support/Claude/claude_desktop_config.json）：
 * {
 *   "mcpServers": {
 *     "kbpay": {
 *       "command": "node",
 *       "args": ["/path/to/KeBaiPay/dist/agent/mcp/standalone.js"],
 *       "env": {
 *         "DATABASE_URL": "postgresql://...",
 *         "REDIS_URL": "redis://..."
 *       }
 *     }
 *   }
 * }
 *
 * Cursor 配置示例（~/.cursor/mcp.json）：
 * {
 *   "mcpServers": {
 *     "kbpay": { "command": "node", "args": [".../standalone.js"] }
 *   }
 * }
 */
import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '..', '..', '..', '.env') })

import { PrismaService } from '../../prisma/prisma.service'
import { fenToYuan } from '../../common/helpers'

async function main() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')

  const prisma = new PrismaService()
  const server = new McpServer({
    name: 'kbpay',
    version: '2.1.0',
  })
  // 用 as any 规避 MCP SDK 在 TS 下的 Zod schema 严格签名校验，
  // 运行时 MCP SDK 接受 { type: 'string' } 等 JSON Schema 形式参数。
  const s = server as any

  // 查询用户余额
  s.tool(
    'kbpay_query_balance',
    '查询 KeBaiPay 用户钱包余额',
    { userId: { type: 'string', description: '用户 ID' } },
    async (args: any) => {
      const account = await prisma.account.findUnique({
        where: { userId: args.userId },
        select: { availableBalance: true, frozenBalance: true, totalBalance: true },
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            userId: args.userId,
            balanceYuan: account ? fenToYuan(account.totalBalance) : '0.00',
            availableYuan: account ? fenToYuan(account.availableBalance) : '0.00',
            frozenYuan: account ? fenToYuan(account.frozenBalance) : '0.00',
          }),
        }],
      }
    },
  )

  // 查询订单详情
  s.tool(
    'kbpay_query_order',
    '查询 KeBaiPay 订单详情',
    { orderNo: { type: 'string', description: '订单号' } },
    async (args: any) => {
      const order = await prisma.paymentOrder.findUnique({
        where: { orderNo: args.orderNo },
        select: { orderNo: true, amount: true, status: true, createdAt: true, paidAt: true },
      })
      if (!order) {
        return { content: [{ type: 'text' as const, text: `订单 ${args.orderNo} 不存在` }] }
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...order, amountYuan: fenToYuan(order.amount) }),
        }],
      }
    },
  )

  // 查询账单
  s.tool(
    'kbpay_query_bill',
    '查询用户账单列表',
    {
      userId: { type: 'string', description: '用户 ID' },
      limit: { type: 'number', description: '返回条数，默认 20' },
    },
    async (args: any) => {
      const limit = Math.min(args.limit ?? 20, 100)
      const bills = await prisma.bill.findMany({
        where: { userId: args.userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, type: true, direction: true,
          amount: true, counterparty: true, remark: true, createdAt: true,
        },
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: bills.length,
            bills: bills.map((b) => ({ ...b, amountYuan: fenToYuan(b.amount) })),
          }),
        }],
      }
    },
  )

  // 列出风险事件
  s.tool(
    'kbpay_list_risk_events',
    '查询 KeBaiPay 风险事件列表',
    {
      level: { type: 'string', description: 'LOW/MEDIUM/HIGH' },
      limit: { type: 'number', description: '返回条数' },
    },
    async (args: any) => {
      const limit = Math.min(args.limit ?? 50, 200)
      const where: any = {}
      if (args.level) where.level = args.level
      const events = await prisma.riskEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: events.length, events }),
        }],
      }
    },
  )

  // 列出对账差异
  s.tool(
    'kbpay_list_recon_diffs',
    '查询 KeBaiPay 对账差异项列表',
    {
      status: { type: 'string', description: 'PENDING/INVESTIGATING/RESOLVED/IGNORED' },
      limit: { type: 'number', description: '返回条数' },
    },
    async (args: any) => {
      const limit = Math.min(args.limit ?? 20, 100)
      const where: any = {}
      if (args.status) where.status = args.status
      const diffs = await prisma.reconciliationDifferenceItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: diffs.length, diffs }),
        }],
      }
    },
  )

  // 启动 stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('KeBaiPay MCP Server 已启动（stdio transport），注册 5 个工具')
}

main().catch((err) => {
  console.error('KeBaiPay MCP Server 启动失败:', err)
  process.exit(1)
})
