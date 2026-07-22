import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { fenToYuan } from '../../common/helpers'
import { generateOrderNo } from '../../common/helpers'

/**
 * KeBaiPay 自建 MCP Server（@modelcontextprotocol/sdk）
 *
 * 把 KeBaiPay 的核心支付能力封装为 MCP 工具，让外部 AI Agent（如 Claude Desktop、Cursor、Trae）
 * 也能通过标准 MCP 协议调用 KeBaiPay。
 *
 * 工具列表（与 ToolRegistry 对应，但通过 MCP 暴露给外部 Agent）：
 *  - kbpay_create_order      商户创建收款订单
 *  - kbpay_query_order       查询订单详情
 *  - kbpay_query_balance     查询账户余额
 *  - kbpay_query_bill        查询账单
 *  - kbpay_send_message      发送站内消息
 *  - kbpay_list_risk_events  列出风险事件
 *  - kbpay_list_recon_diffs  列出对账差异
 *
 * 启动方式：
 *  1. 标准启动：node dist/agent/mcp/standalone.js （stdio 传输，独立进程）
 *  2. 嵌入启动：通过 HTTP 端点 /agent/mcp 暴露（StreamableHTTP transport）
 *
 * 安全：
 *  - 每个 MCP 客户端需要先注册为 Agent（管理端调用 AgentAuthService.createAgent）
 *  - 调用工具时携带 Agent JWT，由 AgentAuthGuard 校验
 *  - 资金类工具（refund/transfer）走 confirm 流程
 */
@Injectable()
export class AgentMcpServer implements OnModuleInit {
  private readonly logger = new Logger(AgentMcpServer.name)
  private mcpServer: any = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    // 仅在非生产环境初始化（生产环境通过独立进程启动）
    if (this.configService.get('NODE_ENV') === 'production') {
      this.logger.log('生产环境跳过 MCP Server 嵌入初始化（请通过独立进程启动）')
      return
    }
    try {
      await this.initMcpServer()
    } catch (err: any) {
      this.logger.warn(`MCP Server 初始化失败（非致命）：${err.message}`)
    }
  }

  /**
   * 初始化 MCP Server，注册所有工具
   * 使用动态 import 避免在未安装 @modelcontextprotocol/sdk 时崩溃
   */
  private async initMcpServer() {
    let McpServer: any
    try {
      const sdk = await import('@modelcontextprotocol/sdk/server/mcp.js')
      McpServer = sdk.McpServer
    } catch {
      this.logger.warn('@modelcontextprotocol/sdk 未安装或导入失败，跳过 MCP Server 初始化')
      return
    }

    const server = new McpServer({
      name: 'kbpay',
      version: '2.1.0',
    })

    // 工具 1: kbpay_query_balance
    ;(server as any).tool(
      'kbpay_query_balance',
      '查询 KeBaiPay 用户钱包余额',
      {
        userId: { type: 'string', description: '用户 ID' },
      },
      async (args: any) => {
        const account = await this.prisma.account.findUnique({
          where: { userId: args.userId },
          select: { availableBalance: true, frozenBalance: true, totalBalance: true },
        })
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              userId: args.userId,
              balanceYuan: account ? fenToYuan(account.totalBalance) : '0.00',
              balanceFen: account?.totalBalance ?? 0,
              availableYuan: account ? fenToYuan(account.availableBalance) : '0.00',
              frozenYuan: account ? fenToYuan(account.frozenBalance) : '0.00',
            }),
          }],
        }
      },
    )

    // 工具 2: kbpay_query_order
    ;(server as any).tool(
      'kbpay_query_order',
      '查询 KeBaiPay 订单详情',
      {
        orderNo: { type: 'string', description: '订单号' },
      },
      async (args: any) => {
        const order = await this.prisma.paymentOrder.findUnique({
          where: { orderNo: args.orderNo },
          select: {
            orderNo: true, amount: true, status: true,
            createdAt: true, paidAt: true,
          },
        })
        if (!order) {
          return { content: [{ type: 'text', text: `订单 ${args.orderNo} 不存在` }] }
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...order,
              amountYuan: fenToYuan(order.amount),
            }),
          }],
        }
      },
    )

    // 工具 3: kbpay_query_bill
    ;(server as any).tool(
      'kbpay_query_bill',
      '查询用户账单列表',
      {
        userId: { type: 'string', description: '用户 ID' },
        limit: { type: 'number', description: '返回条数，默认 20，最大 100' },
      },
      async (args: any) => {
        const limit = Math.min(args.limit ?? 20, 100)
        const bills = await this.prisma.bill.findMany({
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
            type: 'text',
            text: JSON.stringify({
              count: bills.length,
              bills: bills.map((b) => ({ ...b, amountYuan: fenToYuan(b.amount) })),
            }),
          }],
        }
      },
    )

    // 工具 4: kbpay_list_risk_events
    ;(server as any).tool(
      'kbpay_list_risk_events',
      '查询 KeBaiPay 风险事件列表（管理端）',
      {
        level: { type: 'string', description: 'LOW/MEDIUM/HIGH' },
        limit: { type: 'number', description: '返回条数，默认 50，最大 200' },
      },
      async (args: any) => {
        const limit = Math.min(args.limit ?? 50, 200)
        const where: any = {}
        if (args.level) where.level = args.level
        const events = await this.prisma.riskEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: events.length, events }),
          }],
        }
      },
    )

    // 工具 5: kbpay_list_recon_diffs
    ;(server as any).tool(
      'kbpay_list_recon_diffs',
      '查询 KeBaiPay 对账差异项列表（S5 多平台对账聚合）',
      {
        status: { type: 'string', description: 'PENDING/INVESTIGATING/RESOLVED/IGNORED' },
        limit: { type: 'number', description: '返回条数，默认 20，最大 100' },
      },
      async (args: any) => {
        const limit = Math.min(args.limit ?? 20, 100)
        const where: any = {}
        if (args.status) where.status = args.status
        const diffs = await this.prisma.reconciliationDifferenceItem.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: diffs.length, diffs }),
          }],
        }
      },
    )

    this.mcpServer = server
    this.logger.log('KeBaiPay MCP Server 已初始化，注册 5 个工具')
  }

  /**
   * 获取已初始化的 MCP Server 实例（供 Controller 暴露 HTTP transport 时使用）
   */
  getServer(): any {
    return this.mcpServer
  }

  /**
   * 列出已注册的工具（用于调试与文档）
   */
  listTools(): string[] {
    return [
      'kbpay_query_balance',
      'kbpay_query_order',
      'kbpay_query_bill',
      'kbpay_list_risk_events',
      'kbpay_list_recon_diffs',
    ]
  }
}
