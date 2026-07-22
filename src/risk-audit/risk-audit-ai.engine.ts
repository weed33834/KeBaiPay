import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RiskEngineService, type RiskRule } from '../risk/risk-engine.service'
import {
  RiskAuditIntent,
  RiskAuditMessageRole,
  TransactionType,
  TransactionStatus,
  UserStatus,
} from '../common/enums'
import { fenToYuan } from '../common/helpers'

/**
 * AI 对话引擎（本地模板版）
 *
 * 由于沙箱环境无 LLM，使用模式匹配 + 模板回复模拟 AI 对话能力：
 *  - 识别意图：规则查询 / 事件查询 / 交易查询 / 申诉 / 帮助
 *  - 调用对应工具（Prisma/RiskEngine）获取数据
 *  - 模板化输出，附带 metadata（机器可读结构）
 */
@Injectable()
export class RiskAuditAiEngine {
  private readonly logger = new Logger(RiskAuditAiEngine.name)

  // 意图关键词映射（按优先级顺序匹配）
  private static readonly INTENT_KEYWORDS: { intent: RiskAuditIntent; keywords: string[] }[] = [
    { intent: RiskAuditIntent.GREETING, keywords: ['你好', '您好', 'hi', 'hello', '在吗', '帮助', 'help', '能做什么'] },
    { intent: RiskAuditIntent.APPEAL, keywords: ['申诉', '解冻', '恢复', '投诉', 'appeal', 'unfreeze'] },
    { intent: RiskAuditIntent.EVENT_EXPLAIN, keywords: ['为什么', '为何', '为啥', '被拦截', '被拒', '失败', '拦截', 'why'] },
    { intent: RiskAuditIntent.RULE_DETAIL, keywords: ['规则详情', '规则是什么', '讲讲规则', '详细介绍', '具体规则'] },
    { intent: RiskAuditIntent.RULE_LIST, keywords: ['规则', '风控', '限额', '限制', 'rule'] },
    { intent: RiskAuditIntent.EVENT_LIST, keywords: ['风险事件', '风控事件', '风险记录', 'event', '事件'] },
    { intent: RiskAuditIntent.TRANSACTION_LIST, keywords: ['交易', '转账', '流水', '订单', 'transaction', 'record'] },
    { intent: RiskAuditIntent.ACCOUNT_STATUS, keywords: ['账户', '余额', '状态', '冻结', 'account', 'status'] },
  ]

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngine: RiskEngineService,
  ) {}

  /** 识别用户消息意图 */
  detectIntent(content: string): RiskAuditIntent {
    const lower = content.toLowerCase().trim()
    for (const { intent, keywords } of RiskAuditAiEngine.INTENT_KEYWORDS) {
      if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        return intent
      }
    }
    return RiskAuditIntent.UNKNOWN
  }

  /** 处理用户消息并生成 AI 回复 */
  async handle(
    userId: string,
    content: string,
  ): Promise<{ role: typeof RiskAuditMessageRole.ASSISTANT; content: string; intent: RiskAuditIntent; metadata: any }> {
    const intent = this.detectIntent(content)
    this.logger.log(`AI 处理消息: intent=${intent}, content="${content.slice(0, 50)}"`)

    let replyContent = ''
    let metadata: any = null

    switch (intent) {
      case RiskAuditIntent.GREETING:
        replyContent = this.handleGreeting()
        break
      case RiskAuditIntent.RULE_LIST:
        ;({ content: replyContent, metadata } = await this.handleRuleList())
        break
      case RiskAuditIntent.RULE_DETAIL:
        ;({ content: replyContent, metadata } = await this.handleRuleDetail(content))
        break
      case RiskAuditIntent.EVENT_LIST:
        ;({ content: replyContent, metadata } = await this.handleEventList(userId))
        break
      case RiskAuditIntent.EVENT_EXPLAIN:
        ;({ content: replyContent, metadata } = await this.handleEventExplain(userId))
        break
      case RiskAuditIntent.TRANSACTION_LIST:
        ;({ content: replyContent, metadata } = await this.handleTransactionList(userId))
        break
      case RiskAuditIntent.ACCOUNT_STATUS:
        ;({ content: replyContent, metadata } = await this.handleAccountStatus(userId))
        break
      case RiskAuditIntent.APPEAL:
        ;({ content: replyContent, metadata } = await this.handleAppeal(userId))
        break
      default:
        replyContent = this.handleUnknown(content)
    }

    return {
      role: RiskAuditMessageRole.ASSISTANT,
      content: replyContent,
      intent,
      metadata,
    }
  }

  // ============== 各意图处理 ==============

  private handleGreeting(): string {
    return [
      '您好！我是 KeBaiPay 风控助手，可以为您提供以下帮助：',
      '',
      '1. 【规则查询】查询当前生效的风控规则和限额',
      '2. 【风险事件】查询您的风险事件记录及处理状态',
      '3. 【拦截解释】解释为什么您的交易被拦截',
      '4. 【交易流水】查询您最近的交易记录',
      '5. 【账户状态】查询账户余额和冻结状态',
      '6. 【申诉解冻】提交申诉请求',
      '',
      '请直接用自然语言描述您的问题，例如："我有哪些风控规则？"、"我最近的交易是什么？"、"为什么我被拦截了？"',
    ].join('\n')
  }

  private async handleRuleList(): Promise<{ content: string; metadata: any }> {
    const rules = await this.riskEngine.listAllRules()
    const lines: string[] = ['当前生效的风控规则如下：', '']
    for (const rule of rules) {
      const params = this.formatRuleParams(rule)
      const status = rule.enabled ? '✓ 启用' : '✗ 禁用'
      lines.push(`【${rule.name}】(${rule.code})`)
      lines.push(`  状态: ${status}`)
      lines.push(`  动作: ${rule.action}`)
      if (params) lines.push(`  参数: ${params}`)
      lines.push('')
    }
    lines.push(`共 ${rules.length} 条规则。`)
    return { content: lines.join('\n'), metadata: { rules } }
  }

  private async handleRuleDetail(content: string): Promise<{ content: string; metadata: any }> {
    const rules = await this.riskEngine.listAllRules()
    // 尝试从消息中匹配规则 code 或 name
    const matched = rules.find(
      (r) => content.includes(r.code) || content.includes(r.name),
    )
    if (!matched) {
      const { content: c, metadata } = await this.handleRuleList()
      return {
        content: '未匹配到具体规则，已为您列出全部规则：\n\n' + c,
        metadata,
      }
    }
    const params = this.formatRuleParams(matched)
    const lines: string[] = [
      `规则详情：${matched.name}`,
      '',
      `代码: ${matched.code}`,
      `状态: ${matched.enabled ? '启用' : '禁用'}`,
      `动作: ${matched.action}`,
      `参数: ${params || '无'}`,
    ]
    return { content: lines.join('\n'), metadata: { rule: matched } }
  }

  private async handleEventList(userId: string): Promise<{ content: string; metadata: any }> {
    const events = await this.prisma.riskEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    if (events.length === 0) {
      return { content: '您当前没有风险事件记录。', metadata: { events: [] } }
    }
    const lines: string[] = ['您最近的风险事件（共 10 条）：', '']
    for (const e of events) {
      const time = e.createdAt.toISOString().slice(0, 19).replace('T', ' ')
      const handled = e.handled ? '已处理' : '待处理'
      lines.push(`- [${e.level}] ${e.type} @ ${time}`)
      lines.push(`  描述: ${e.description}`)
      lines.push(`  状态: ${handled}`)
      lines.push('')
    }
    return { content: lines.join('\n'), metadata: { events } }
  }

  private async handleEventExplain(userId: string): Promise<{ content: string; metadata: any }> {
    // 查询用户最近的高级别风险事件
    const recentEvent = await this.prisma.riskEvent.findFirst({
      where: { userId, handled: false },
      orderBy: { createdAt: 'desc' },
    })
    if (!recentEvent) {
      return {
        content: '未找到您最近的未处理风险事件。如果您遇到交易失败，可能是其他原因，建议联系客服。',
        metadata: null,
      }
    }
    // 根据事件类型匹配规则
    const rules = await this.riskEngine.listAllRules()
    const matchedRule = this.matchRuleByEventType(recentEvent.type, rules)
    const lines: string[] = [
      '经核查，您最近的交易触发以下风险规则：',
      '',
      `事件类型: ${recentEvent.type}`,
      `风险等级: ${recentEvent.level}`,
      `事件描述: ${recentEvent.description}`,
      `发生时间: ${recentEvent.createdAt.toISOString().slice(0, 19).replace('T', ' ')}`,
    ]
    if (matchedRule) {
      lines.push('')
      lines.push(`触发规则: ${matchedRule.name} (${matchedRule.code})`)
      lines.push(`处置动作: ${matchedRule.action}`)
      lines.push(`规则参数: ${this.formatRuleParams(matchedRule)}`)
    }
    lines.push('')
    lines.push('建议：')
    if (matchedRule?.action === 'BLOCK') {
      lines.push('- 该规则为强制拦截，您可以调整交易金额或频率后重试')
      lines.push('- 如确认为误拦截，可回复"申诉"提交工单')
    } else if (matchedRule?.action === 'WARN') {
      lines.push('- 该规则仅警告不拦截，您的交易已正常完成')
      lines.push('- 请关注后续交易频率，避免触发更严格规则')
    } else {
      lines.push('- 请等待人工审核结果')
    }
    return { content: lines.join('\n'), metadata: { event: recentEvent, matchedRule } }
  }

  private async handleTransactionList(userId: string): Promise<{ content: string; metadata: any }> {
    const txs = await this.prisma.transactionOrder.findMany({
      where: {
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    if (txs.length === 0) {
      return { content: '您当前没有交易记录。', metadata: { transactions: [] } }
    }
    const lines: string[] = ['您最近的交易记录（共 10 条）：', '']
    for (const t of txs) {
      const time = t.createdAt.toISOString().slice(0, 19).replace('T', ' ')
      const amount = fenToYuan(t.amount)
      const direction = t.fromUserId === userId ? '支出' : '收入'
      lines.push(`- ${t.type} ${direction} ¥${amount} [${t.status}] @ ${time}`)
      lines.push(`  订单号: ${t.orderNo}`)
      if (t.remark) lines.push(`  备注: ${t.remark}`)
      lines.push('')
    }
    return { content: lines.join('\n'), metadata: { transactions: txs } }
  }

  private async handleAccountStatus(userId: string): Promise<{ content: string; metadata: any }> {
    const [user, account] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.account.findUnique({ where: { userId } }),
    ])
    if (!user) {
      return { content: '未找到用户信息。', metadata: null }
    }
    const lines: string[] = [
      '您的账户状态：',
      '',
      `用户状态: ${user.status}`,
    ]
    if (user.status === UserStatus.FROZEN) {
      lines.push('  ⚠️ 您的账户已被冻结，无法进行资金操作')
      lines.push('  如需申诉，请回复"申诉"')
    } else if (user.status === UserStatus.EXPENSE_RESTRICTED) {
      lines.push('  ⚠️ 您的账户被限制支出')
    } else if (user.status === UserStatus.INCOME_RESTRICTED) {
      lines.push('  ⚠️ 您的账户被限制收入')
    } else {
      lines.push('  ✓ 账户正常')
    }
    lines.push(`风险等级: ${user.riskLevel}`)
    if (account) {
      lines.push(`可用余额: ¥${fenToYuan(account.availableBalance)}`)
      lines.push(`冻结余额: ¥${fenToYuan(account.frozenBalance)}`)
      lines.push(`总余额: ¥${fenToYuan(account.totalBalance)}`)
    }
    return { content: lines.join('\n'), metadata: { user, account } }
  }

  private async handleAppeal(userId: string): Promise<{ content: string; metadata: any }> {
    // 创建一条 SYSTEM 风险事件作为申诉工单
    const existingAppeal = await this.prisma.riskEvent.findFirst({
      where: {
        userId,
        type: 'APPEAL',
        handled: false,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (existingAppeal) {
      return {
        content:
          '您已有一条正在处理的申诉工单：\n\n' +
          `提交时间: ${existingAppeal.createdAt.toISOString().slice(0, 19).replace('T', ' ')}\n` +
          `描述: ${existingAppeal.description}\n\n` +
          '请耐心等待风控人员审核，通常 1-3 个工作日内处理完毕。',
        metadata: { appeal: existingAppeal },
      }
    }
    const appeal = await this.prisma.riskEvent.create({
      data: {
        userId,
        type: 'APPEAL',
        level: 'MEDIUM',
        description: '用户通过 AI 助手提交的申诉请求，等待人工审核',
      },
    })
    return {
      content:
        '✓ 您的申诉工单已创建，工单信息：\n\n' +
        `工单 ID: ${appeal.id}\n` +
        `提交时间: ${appeal.createdAt.toISOString().slice(0, 19).replace('T', ' ')}\n\n` +
        '风控人员将在 1-3 个工作日内审核，处理结果会通过站内消息通知您。',
      metadata: { appeal },
    }
  }

  private handleUnknown(content: string): string {
    return [
      '抱歉，我没有理解您的问题。',
      '',
      '您可以尝试以下问题：',
      '• "我有哪些风控规则？"',
      '• "为什么我的交易被拦截？"',
      '• "我最近的风险事件"',
      '• "查询我的账户状态"',
      '• "我要申诉"',
      '',
      `您输入的是："${content.slice(0, 100)}"`,
    ].join('\n')
  }

  // ============== 工具方法 ==============

  private formatRuleParams(rule: RiskRule): string {
    const parts: string[] = []
    if (rule.params.maxAmount != null) {
      parts.push(`单笔最大金额=¥${fenToYuan(rule.params.maxAmount)}`)
    }
    if (rule.params.maxDailyCount != null) {
      parts.push(`单日最大次数=${rule.params.maxDailyCount}`)
    }
    if (rule.params.maxDailyAmount != null) {
      parts.push(`单日最大金额=¥${fenToYuan(rule.params.maxDailyAmount)}`)
    }
    if (rule.params.windowSeconds != null) {
      parts.push(`窗口=${rule.params.windowSeconds}s`)
    }
    if (rule.params.windowMaxCount != null) {
      parts.push(`窗口最大次数=${rule.params.windowMaxCount}`)
    }
    return parts.join(', ')
  }

  private matchRuleByEventType(eventType: string, rules: RiskRule[]): RiskRule | null {
    // 事件类型到规则 code 的映射
    const mapping: Record<string, string> = {
      LARGE_TRANSFER: 'single_amount',
      LARGE_WITHDRAWAL: 'single_amount',
      LARGE_PAYMENT: 'single_amount',
      FREQUENT_TRANSACTION: 'frequency',
      SUSPICIOUS_RED_PACKET: 'frequency',
      FREQUENT_LOGIN: 'ip_frequency',
      SUSPICIOUS_DEVICE: 'ip_frequency',
    }
    const code = mapping[eventType]
    if (!code) return null
    return rules.find((r) => r.code === code) ?? null
  }
}
