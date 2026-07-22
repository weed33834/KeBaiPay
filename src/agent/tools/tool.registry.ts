import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { LlmTool } from '../llm/llm.service'
import type { AgentCurrentUser } from '../agent-current-user.interface'
import { kbError, KBErrorCodes } from '../../common/error-codes'
import { fenToYuan } from '../../common/helpers'

/**
 * 工具注册表：
 *  - 统一管理所有 Agent 可调用的工具
 *  - 工具按场景分组（wallet / merchant / risk）
 *  - 资金类工具标记 requireConfirm=true，由 AgentService 强制二次确认
 *
 * 工具实现原则：
 *  1. 只读类工具直接执行（query_balance、query_bill 等）
 *  2. 写入类工具先写 AgentOperationLog（PENDING_CONFIRM），再由用户确认后执行
 *  3. 工具执行依赖 Agent 上下文（subjectId/scopes/authScopes），从闭包传入
 */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按场景获取可用工具列表
   * @param ctx Agent 上下文（subjectId / authScopes 等）
   * @param scenario 场景：wallet / merchant / risk / support
   */
  getTools(ctx: AgentCurrentUser, scenario: string, deps: ToolDeps): LlmTool[] {
    const tools: LlmTool[] = []
    if (scenario === 'wallet') {
      tools.push(...this.walletTools(ctx, deps))
    } else if (scenario === 'merchant') {
      tools.push(...this.merchantTools(ctx, deps))
    } else if (scenario === 'risk') {
      tools.push(...this.riskTools(ctx, deps))
    } else if (scenario === 'support') {
      tools.push(...this.walletTools(ctx, deps), ...this.merchantTools(ctx, deps))
    }
    return tools
  }

  /** 校验 scope 权限 */
  private checkScope(ctx: AgentCurrentUser, requiredScope: string) {
    const allowed = (ctx.authScopes ?? ctx.scopes ?? []).includes(requiredScope)
    if (!allowed) {
      throw new ForbiddenException(kbError(KBErrorCodes.AGENT_SCOPE_DENIED, `缺少 scope: ${requiredScope}`))
    }
  }

  /** ========== C 端钱包管家工具 ========== */
  private walletTools(ctx: AgentCurrentUser, deps: ToolDeps): LlmTool[] {
    return [
      {
        name: 'kbpay_query_balance',
        description: '查询当前用户钱包余额',
        inputSchema: { type: 'object', properties: {} },
        requireConfirm: false,
        execute: async () => {
          this.checkScope(ctx, 'wallet:read')
          const account = await this.prisma.account.findUnique({
            where: { userId: ctx.subjectId },
            select: { availableBalance: true, frozenBalance: true, totalBalance: true },
          })
          return {
            balanceYuan: account ? fenToYuan(account.totalBalance) : '0.00',
            balanceFen: account?.totalBalance ?? 0,
            availableYuan: account ? fenToYuan(account.availableBalance) : '0.00',
            frozenYuan: account ? fenToYuan(account.frozenBalance) : '0.00',
          }
        },
      },
      {
        name: 'kbpay_query_bill',
        description: '查询用户账单列表（最近 N 天）',
        inputSchema: {
          type: 'object',
          properties: {
            days: { type: 'number', description: '查询最近多少天，默认 30' },
            limit: { type: 'number', description: '返回条数，默认 20' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:read')
          const days = args?.days ?? 30
          const limit = Math.min(args?.limit ?? 20, 100)
          const since = new Date(Date.now() - days * 86400_000)
          const bills = await this.prisma.bill.findMany({
            where: { userId: ctx.subjectId, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
              id: true,
              type: true,
              direction: true,
              amount: true,
              counterparty: true,
              remark: true,
              createdAt: true,
            },
          })
          return {
            count: bills.length,
            bills: bills.map((b) => ({ ...b, amountYuan: fenToYuan(b.amount) })),
          }
        },
      },
      {
        name: 'kbpay_send_message',
        description: '向用户发送站内消息（如异常告警、推荐等）',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH'] },
          },
          required: ['title', 'content'],
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:notify')
          return deps.messagesService.sendMessage({
            userId: ctx.subjectId!,
            category: 'SYSTEM',
            title: args.title,
            content: args.content,
            channels: 'IN_APP',
            priority: args.priority ?? 'NORMAL',
          })
        },
      },
      {
        name: 'kbpay_claim_coupon',
        description: '为用户领取优惠券',
        inputSchema: {
          type: 'object',
          properties: {
            couponNo: { type: 'string', description: '优惠券编号（couponNo）' },
          },
          required: ['couponNo'],
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:write:coupon')
          return deps.couponsService.claim(ctx.subjectId!, args.couponNo)
        },
      },
      {
        name: 'kbpay_transfer',
        description: '用户间转账（需要用户二次确认）',
        inputSchema: {
          type: 'object',
          properties: {
            toUserId: { type: 'string' },
            amountYuan: { type: 'number', description: '金额（元）' },
            remark: { type: 'string' },
          },
          required: ['toUserId', 'amountYuan'],
        },
        requireConfirm: true,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:write:transfer')
          // 该工具实际执行由 confirm 流程触发，这里只返回待确认信息
          return {
            pending: true,
            message: `准备向用户 ${args.toUserId} 转账 ${args.amountYuan} 元，等待用户确认`,
            payload: args,
          }
        },
      },
    ]
  }

  /** ========== B 端店长助理工具 ========== */
  private merchantTools(ctx: AgentCurrentUser, deps: ToolDeps): LlmTool[] {
    return [
      {
        name: 'kbpay_query_merchant_orders',
        description: '查询商户订单列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: '订单状态过滤' },
            limit: { type: 'number' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'merchant:read')
          const limit = Math.min(args?.limit ?? 20, 100)
          const where: any = { merchantId: ctx.subjectId }
          if (args?.status) where.status = args.status
          const orders = await this.prisma.paymentOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
              orderNo: true, amount: true, status: true, createdAt: true,
            },
          })
          return { count: orders.length, orders }
        },
      },
      {
        name: 'kbpay_query_merchant_balance',
        description: '查询商户余额（通过 Merchant.userId 关联 Account）',
        inputSchema: { type: 'object', properties: {} },
        requireConfirm: false,
        execute: async () => {
          this.checkScope(ctx, 'merchant:read')
          // 商户主体 subjectId 是 Merchant.id，需通过 Merchant.userId 关联到 Account
          const merchant = await this.prisma.merchant.findUnique({
            where: { id: ctx.subjectId },
            select: {
              userId: true,
              merchantName: true,
              status: true,
              user: { select: { account: { select: { availableBalance: true, frozenBalance: true, totalBalance: true } } } },
            },
          })
          if (!merchant) return { balanceYuan: '0.00', message: '商户不存在' }
          const acc = merchant.user?.account
          return {
            merchantName: merchant.merchantName,
            status: merchant.status,
            balanceYuan: acc ? fenToYuan(acc.totalBalance) : '0.00',
            availableYuan: acc ? fenToYuan(acc.availableBalance) : '0.00',
            frozenYuan: acc ? fenToYuan(acc.frozenBalance) : '0.00',
          }
        },
      },
      {
        name: 'kbpay_query_reconciliation_diff',
        description: '查询对账差异项列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'merchant:read')
          const limit = Math.min(args?.limit ?? 20, 100)
          const diffs = await this.prisma.reconciliationDifferenceItem.findMany({
            where: args?.status ? { status: args.status } : undefined,
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
          return { count: diffs.length, diffs }
        },
      },
    ]
  }

  /** ========== A 端风控审计官工具 ========== */
  private riskTools(ctx: AgentCurrentUser, deps: ToolDeps): LlmTool[] {
    return [
      {
        name: 'kbpay_query_risk_events',
        description: '查询风险事件列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'PENDING/HANDLED' },
            level: { type: 'string', description: 'LOW/MEDIUM/HIGH' },
            limit: { type: 'number' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'risk:read')
          const limit = Math.min(args?.limit ?? 50, 200)
          const where: any = {}
          if (args?.status) where.handled = args.status === 'HANDLED'
          if (args?.level) where.level = args.level
          const events = await this.prisma.riskEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
          return { count: events.length, events }
        },
      },
      {
        name: 'kbpay_query_health',
        description: '查询系统与调度任务健康状态',
        inputSchema: { type: 'object', properties: {} },
        requireConfirm: false,
        execute: async () => {
          this.checkScope(ctx, 'risk:read')
          return deps.scheduleHealthService.getScheduleStatus()
        },
      },
      {
        name: 'kbpay_query_reconciliation_diffs',
        description: '查询 S5 多平台对账差异列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'risk:read')
          const limit = Math.min(args?.limit ?? 20, 100)
          return this.prisma.reconciliationDifferenceItem.findMany({
            where: args?.status ? { status: args.status } : undefined,
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        },
      },
    ]
  }
}

/**
 * Tool 执行所需的依赖（由 AgentModule 注入）
 *  - messagesService：发站内消息
 *  - couponsService：领取优惠券
 *  - scheduleHealthService：查调度健康
 */
export interface ToolDeps {
  messagesService: any
  couponsService: any
  scheduleHealthService: any
}
