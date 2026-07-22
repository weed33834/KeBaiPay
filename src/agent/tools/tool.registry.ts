import { Injectable, Logger, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common'
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

  /** 校验 subjectId 非空（防止 Token 缺失 subjectId 时的越权） */
  private requireSubjectId(ctx: AgentCurrentUser): string {
    if (!ctx.subjectId) {
      throw new ForbiddenException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_REVOKED, '智能体未绑定用户主体'))
    }
    return ctx.subjectId
  }

  /** 校验金额（元）：非负、有限、在合理范围内 */
  private validateAmountYuan(amount: any): number {
    const n = Number(amount)
    if (!Number.isFinite(n) || n < 0.01) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '金额必须为不小于 0.01 的正数'))
    }
    if (n > 500000) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '单笔金额不能超过 50 万元'))
    }
    return n
  }

  /** 限制字符串长度，防止 DoS / 存储膨胀 */
  private truncate(str: any, max: number): string {
    if (typeof str !== 'string') return ''
    return str.slice(0, max)
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
          const subjectId = this.requireSubjectId(ctx)
          const account = await this.prisma.account.findUnique({
            where: { userId: subjectId },
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
            days: { type: 'number', description: '查询最近多少天，默认 30，最大 365' },
            limit: { type: 'number', description: '返回条数，默认 20' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:read')
          const subjectId = this.requireSubjectId(ctx)
          const days = Math.min(Math.max(1, Number(args?.days) || 30), 365)
          const limit = Math.min(args?.limit ?? 20, 100)
          const since = new Date(Date.now() - days * 86400_000)
          const bills = await this.prisma.bill.findMany({
            where: { userId: subjectId, createdAt: { gte: since } },
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
          const subjectId = this.requireSubjectId(ctx)
          const title = this.truncate(args?.title, 100)
          const content = this.truncate(args?.content, 2000)
          if (!title || !content) {
            throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '标题和内容不能为空'))
          }
          return deps.messagesService.sendMessage({
            userId: subjectId,
            category: 'SYSTEM',
            title,
            content,
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
          const subjectId = this.requireSubjectId(ctx)
          const couponNo = this.truncate(args?.couponNo, 64)
          if (!couponNo) {
            throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '优惠券编号不能为空'))
          }
          return deps.couponsService.claim(subjectId, couponNo)
        },
      },
      {
        name: 'kbpay_transfer',
        description: '用户间转账（需要用户二次确认）',
        inputSchema: {
          type: 'object',
          properties: {
            toUserId: { type: 'string', description: '收款用户ID' },
            amountYuan: { type: 'number', description: '金额（元），必须为正数且 ≤ 500000' },
            remark: { type: 'string', description: '转账备注，最多 200 字' },
          },
          required: ['toUserId', 'amountYuan'],
        },
        requireConfirm: true,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:write:transfer')
          this.requireSubjectId(ctx)
          // 金额边界校验：防止负数、零、超大、非数字金额进入确认流程
          const amountYuan = this.validateAmountYuan(args?.amountYuan)
          // 收款人 ID 校验
          const toUserId = this.truncate(args?.toUserId, 64)
          if (!toUserId || toUserId === ctx.subjectId) {
            throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '收款人ID无效或不能向自己转账'))
          }
          // 备注长度限制
          const remark = this.truncate(args?.remark, 200)
          // 该工具实际执行由 confirm 流程触发，这里只返回待确认信息
          return {
            pending: true,
            message: `准备向用户 ${toUserId} 转账 ${amountYuan} 元，等待用户确认`,
            payload: { toUserId, amountYuan, remark },
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
        description: '查询当前商户的对账差异项列表',
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
          const subjectId = this.requireSubjectId(ctx)
          const limit = Math.min(args?.limit ?? 20, 100)
          // 安全修复：必须按 merchantId 过滤，防止跨租户数据泄露（IDOR）
          const where: any = { merchantId: subjectId }
          if (args?.status) where.status = args.status
          const diffs = await this.prisma.reconciliationDifferenceItem.findMany({
            where,
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
