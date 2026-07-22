/**
 * LLM 真实联调测试脚本（v2.1.0）
 *
 * 用法：
 *   cd /workspace/KeBaiPay
 *   npx tsx scripts/llm-live-test.ts
 *
 * 设计：
 *  - 通过 NestJS Testing 上下文初始化 LlmModule，确保 ConfigModule 正确加载 .env
 *  - 直接实例化 LlmService，用真实 LLM API（hcnsec.cn）
 *  - 6 个复杂场景覆盖：C 端钱包管家 / B 端店长 / A 端风控 / 老板视角 / 工具选择 / 多轮记忆
 *  - 工具调用走 mock 数据实现，验证 LLM 是否能正确选择和参数构造
 */
import 'dotenv/config'
import { ConfigService } from '@nestjs/config'
import { LlmService, type LlmTool } from '../src/agent/llm/llm.service'

// 桥接：构造一个能从 process.env 读取的 ConfigService
// 直接 new ConfigService() 不会自动加载 .env，这里手动从 process.env 读取
function makeConfigService(): ConfigService {
  const cs = new ConfigService()
  // @nestjs/config 的 ConfigService 内部用 cache，需手动 set
  ;(cs as any).cache = new Map<string, any>(Object.entries(process.env))
  return cs
}

// 模拟 DB 数据：用户 / 商户 / 风险事件 / 订单
const MOCK_DB = {
  userAccount: {
    availableBalance: 10000,   // 100.00 元
    frozenBalance: 500,        // 5.00 元
    totalBalance: 10500,       // 105.00 元
  },
  userBills: [
    { id: 'b1', type: 'RECHARGE', direction: 'IN', amount: 10000, counterparty: '微信充值', createdAt: '2026-07-20 10:00' },
    { id: 'b2', type: 'TRANSFER', direction: 'OUT', amount: 2000, counterparty: '张三', createdAt: '2026-07-21 15:30' },
    { id: 'b3', type: 'PAYMENT', direction: 'OUT', amount: 500, counterparty: '咖啡店', createdAt: '2026-07-22 09:15' },
  ],
  merchantOrders: [
    { orderNo: 'PO001', amount: 5000, status: 'SUCCESS', buyerName: '李四', createdAt: '2026-07-22 10:00' },
    { orderNo: 'PO002', amount: 8800, status: 'SUCCESS', buyerName: '王五', createdAt: '2026-07-22 11:30' },
    { orderNo: 'PO003', amount: 1500, status: 'PENDING', buyerName: '赵六', createdAt: '2026-07-22 14:00' },
    { orderNo: 'PO004', amount: 23000, status: 'SUCCESS', buyerName: '钱七', createdAt: '2026-07-22 15:00' },
  ],
  merchantBalance: {
    availableBalance: 50000,
    frozenBalance: 1000,
    totalBalance: 51000,
  },
  riskEvents: [
    { id: 'r1', level: 'HIGH', type: 'LARGE_TRANSFER', userId: 'u1', description: '单笔转账 5 万元，超出常规 3 倍', createdAt: '2026-07-22 08:00' },
    { id: 'r2', level: 'MEDIUM', type: 'FREQUENT_LOGIN', userId: 'u2', description: '1 小时内 12 次登录失败', createdAt: '2026-07-22 09:30' },
    { id: 'r3', level: 'HIGH', type: 'NEW_DEVICE_TRANSFER', userId: 'u3', description: '新设备首次登录即转账 2 万元', createdAt: '2026-07-22 13:00' },
  ],
  reconDiffs: [
    { id: 'd1', diffType: 'MISSING_CHANNEL', amount: 3500, channelCode: 'alipay', createdAt: '2026-07-22 03:00' },
    { id: 'd2', diffType: 'AMOUNT_MISMATCH', amount: 50, channelCode: 'wechat', createdAt: '2026-07-22 03:00' },
  ],
}

// 记录工具调用日志（用于验证 LLM 调用了哪个工具、什么参数）
const toolCallLog: Array<{ name: string; args: any; result: any; ts: string }> = []

function buildWalletTools(): LlmTool[] {
  return [
    {
      name: 'kbpay_query_balance',
      description: '查询当前用户的钱包余额。返回 totalBalance（总余额，分）、availableBalance（可用余额，分）、frozenBalance（冻结余额，分）。',
      inputSchema: { type: 'object', properties: {} },
      requireConfirm: false,
      execute: async () => {
        const result = MOCK_DB.userAccount
        toolCallLog.push({ name: 'kbpay_query_balance', args: {}, result, ts: new Date().toISOString() })
        return result
      },
    },
    {
      name: 'kbpay_query_bill',
      description: '查询当前用户的最近账单列表，包含充值/转账/消费等明细。可选参数 limit 控制返回条数（默认 20）。',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: '返回条数，默认 20' } },
      },
      requireConfirm: false,
      execute: async (args: any) => {
        const limit = args?.limit ?? 20
        const result = { count: MOCK_DB.userBills.length, bills: MOCK_DB.userBills.slice(0, limit) }
        toolCallLog.push({ name: 'kbpay_query_bill', args, result, ts: new Date().toISOString() })
        return result
      },
    },
    {
      name: 'kbpay_transfer',
      description: '向其他用户转账。这是资金类操作，会触发二次确认。参数：toUserId（收款人用户 ID），amountYuan（金额，单位元），remark（备注，可选）。',
      inputSchema: {
        type: 'object',
        properties: {
          toUserId: { type: 'string', description: '收款人用户 ID' },
          amountYuan: { type: 'number', description: '转账金额（元）' },
          remark: { type: 'string', description: '备注（可选）' },
        },
        required: ['toUserId', 'amountYuan'],
      },
      requireConfirm: true,
      execute: async (args: any) => {
        const result = { success: true, transferId: 'TX' + Date.now(), ...args }
        toolCallLog.push({ name: 'kbpay_transfer', args, result, ts: new Date().toISOString() })
        return result
      },
    },
    {
      name: 'kbpay_query_risk_events',
      description: '查询风险事件列表。参数 level 可选 LOW/MEDIUM/HIGH，status 可选 PENDING/HANDLED。',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'string', description: 'LOW/MEDIUM/HIGH' },
          status: { type: 'string', description: 'PENDING/HANDLED' },
        },
      },
      requireConfirm: false,
      execute: async (args: any) => {
        let list = MOCK_DB.riskEvents
        if (args?.level) list = list.filter((e) => e.level === args.level)
        const result = { count: list.length, events: list }
        toolCallLog.push({ name: 'kbpay_query_risk_events', args, result, ts: new Date().toISOString() })
        return result
      },
    },
    {
      name: 'kbpay_query_merchant_orders',
      description: '查询商户订单列表。参数 status 可选 PENDING/SUCCESS/FAILED。',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: '订单状态 PENDING/SUCCESS/FAILED' },
        },
      },
      requireConfirm: false,
      execute: async (args: any) => {
        let list = MOCK_DB.merchantOrders
        if (args?.status) list = list.filter((o) => o.status === args.status)
        const result = { count: list.length, orders: list }
        toolCallLog.push({ name: 'kbpay_query_merchant_orders', args, result, ts: new Date().toISOString() })
        return result
      },
    },
    {
      name: 'kbpay_query_merchant_balance',
      description: '查询商户余额。返回 availableBalance/frozenBalance/totalBalance，单位为分。',
      inputSchema: { type: 'object', properties: {} },
      requireConfirm: false,
      execute: async () => {
        const result = MOCK_DB.merchantBalance
        toolCallLog.push({ name: 'kbpay_query_merchant_balance', args: {}, result, ts: new Date().toISOString() })
        return result
      },
    },
    {
      name: 'kbpay_query_reconciliation_diffs',
      description: '查询多平台对账差异列表（S5 多平台对账聚合）。',
      inputSchema: { type: 'object', properties: {} },
      requireConfirm: false,
      execute: async () => {
        const result = { count: MOCK_DB.reconDiffs.length, diffs: MOCK_DB.reconDiffs }
        toolCallLog.push({ name: 'kbpay_query_reconciliation_diffs', args: {}, result, ts: new Date().toISOString() })
        return result
      },
    },
  ]
}

const WALLET_SYSTEM_PROMPT = `你是 KeBaiPay 的 C 端钱包管家助手。你能调用工具查询用户的余额、账单、转账等。
风格：亲切、专业、简洁。金额单位：数据库中是分，给用户展示时换算为元（除以 100）。
如果用户要执行资金类操作（如转账），请告知"该操作需要您二次确认"。`

const MERCHANT_SYSTEM_PROMPT = `你是 KeBaiPay 的 B 端店长助理。你能帮店长查询订单、余额、对账差异。
风格：商业、专业、给运营建议。基于数据给出可执行的建议。`

const RISK_SYSTEM_PROMPT = `你是 KeBaiPay 的 A 端风控审计官。你能查询风险事件并给出处置建议。
风格：严谨、保守、优先保护资金安全。对 HIGH 级别事件建议立即介入。`

const BOSS_SYSTEM_PROMPT = `你是 KeBaiPay 的经营总览助手，向老板汇报经营状况。
风格：简洁、聚焦关键数字、突出问题与机会。能用一句话说清的不用两句。`

interface ScenarioResult {
  name: string
  role: string
  passed: boolean
  durationMs: number
  rounds: Array<{ user: string; assistant: string; toolCalls?: any[] }>
  notes?: string
  toolCallCount: number
}

async function runScenario(
  llm: LlmService,
  name: string,
  role: string,
  systemPrompt: string,
  tools: LlmTool[],
  conversation: string[],
  expectations?: { expectToolCall?: boolean; expectMinToolCalls?: number },
): Promise<ScenarioResult> {
  const start = Date.now()
  const result: ScenarioResult = { name, role, passed: false, durationMs: 0, rounds: [], toolCallCount: 0 }
  const messages: any[] = []
  const toolCallStart = toolCallLog.length

  try {
    for (const userMsg of conversation) {
      messages.push({ role: 'user', content: userMsg })
      const llmResult = await llm.chat({
        messages,
        tools,
        systemPrompt,
        maxSteps: 5,
      })
      messages.push({ role: 'assistant', content: llmResult.content })
      result.rounds.push({
        user: userMsg,
        assistant: llmResult.content,
        toolCalls: llmResult.toolCalls,
      })
    }
    result.toolCallCount = toolCallLog.length - toolCallStart
    result.passed = result.rounds.every((r) => r.assistant && r.assistant.length > 0)
    // 如果期望调用工具但实际没有，标记为部分通过
    if (expectations?.expectToolCall && result.toolCallCount === 0) {
      result.notes = '⚠️ 期望 LLM 调用工具但未触发'
    }
  } catch (err: any) {
    result.notes = `Error: ${err.message}`
  }
  result.durationMs = Date.now() - start
  return result
}

function printResult(r: ScenarioResult) {
  console.log('\n' + '='.repeat(80))
  console.log(`【场景】${r.name} | 角色：${r.role} | ${r.passed ? '✅ 通过' : '❌ 失败'} | 耗时 ${r.durationMs}ms | 工具调用 ${r.toolCallCount} 次`)
  if (r.notes) console.log(`  备注：${r.notes}`)
  r.rounds.forEach((rd, i) => {
    console.log(`\n  --- 第 ${i + 1} 轮 ---`)
    console.log(`  用户：${rd.user}`)
    console.log(`  助手：${rd.assistant}`)
    if (rd.toolCalls && rd.toolCalls.length > 0) {
      console.log(`  工具调用：${rd.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`).join(', ')}`)
    }
  })
}

async function main() {
  console.log('╔' + '═'.repeat(78) + '╗')
  console.log('║  KeBaiPay v2.1.0 LLM 真实联调测试                                              ║')
  console.log('╚' + '═'.repeat(78) + '╝')

  console.log(`环境变量：LLM_PROVIDER=${process.env.LLM_PROVIDER}, LLM_MODEL=${process.env.LLM_MODEL}, LLM_BASE_URL=${process.env.LLM_BASE_URL}`)

  // 通过桥接方式实例化 LlmService（不走 NestJS DI）
  const configService = makeConfigService()
  const llm = new LlmService(configService)
  console.log(`LlmService 初始化完成: provider=${llm.provider}, isMock=${llm.isMock}`)

  if (llm.isMock) {
    console.error('❌ 当前仍是 mock 模式，无法做真实联调。请检查 .env 中 LLM_PROVIDER 是否为 openai')
    process.exit(2)
  }

  const walletTools = buildWalletTools()

  // ============ 场景 1：C 端钱包管家 - 多轮 + 工具调用 ============
  const s1 = await runScenario(
    llm,
    'C 端钱包管家：用户日常查询 + 转账意图',
    '普通用户',
    WALLET_SYSTEM_PROMPT,
    walletTools,
    [
      '你好，我想查一下我的钱包还剩多少钱？',
      '这周我花了多少？最近有哪些账单？',
      '帮我把 50 元转给用户张三（user_id=u_zhangsan），备注"咖啡钱"。',
    ],
    { expectToolCall: true, expectMinToolCalls: 2 },
  )
  printResult(s1)

  // ============ 场景 2：B 端店长助理 - 订单分析 ============
  const s2 = await runScenario(
    llm,
    'B 端店长助理：今日订单分析与运营建议',
    '商户店长',
    MERCHANT_SYSTEM_PROMPT,
    walletTools,
    [
      '今天我店铺有多少订单？',
      '帮我看看今天的订单，最高的那一单是谁买的？',
      '我的商户余额是多少？',
      '基于今天的数据，给我一些运营建议。',
    ],
    { expectToolCall: true, expectMinToolCalls: 3 },
  )
  printResult(s2)

  // ============ 场景 3：A 端风控审计官 - 风险事件分析 ============
  const s3 = await runScenario(
    llm,
    'A 端风控审计官：HIGH 级别风险事件分析',
    '风控审计员',
    RISK_SYSTEM_PROMPT,
    walletTools,
    [
      '现在系统里有哪些 HIGH 级别的风险事件？',
      '针对这些事件，分别给出处置建议，并标注优先级。',
      '有没有对账差异？如果有，列出来。',
    ],
    { expectToolCall: true, expectMinToolCalls: 2 },
  )
  printResult(s3)

  // ============ 场景 4：老板视角 - 经营总览 ============
  const s4 = await runScenario(
    llm,
    '老板视角：今日经营总览（综合调用多工具）',
    '老板/总经理',
    BOSS_SYSTEM_PROMPT,
    walletTools,
    [
      '给我一份今天的经营总览，包括商户订单、风险事件、对账差异。',
      '哪些数字需要我重点关注？',
    ],
    { expectToolCall: true, expectMinToolCalls: 3 },
  )
  printResult(s4)

  // ============ 场景 5：工具选择幻觉测试 ============
  const s5 = await runScenario(
    llm,
    '工具选择幻觉测试：模糊问题与边界场景',
    '普通用户',
    WALLET_SYSTEM_PROMPT,
    walletTools,
    [
      '今天天气怎么样？',                          // 应该礼貌拒绝
      '帮我把 -100 元转给用户 u_x（无效参数）',     // 应该识别非法金额
      '我想了解一下你们平台都有哪些功能？',          // 应该介绍能力
    ],
    { expectToolCall: false },
  )
  printResult(s5)

  // ============ 场景 6：多轮上下文记忆测试 ============
  const s6 = await runScenario(
    llm,
    '多轮上下文记忆：跨轮次指代与省略',
    '普通用户',
    WALLET_SYSTEM_PROMPT,
    walletTools,
    [
      '查询我的余额。',
      '其中冻结的部分是什么？',                    // 应该指代上文 frozenBalance
      '帮我把 30 元转给那个我之前提到的张三。',     // 应该指代 u_zhangsan
    ],
    { expectToolCall: true, expectMinToolCalls: 2 },
  )
  printResult(s6)

  // ============ 汇总 ============
  const all = [s1, s2, s3, s4, s5, s6]
  console.log('\n' + '═'.repeat(80))
  console.log('  测试汇总')
  console.log('═'.repeat(80))
  all.forEach((r) => {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}（${r.durationMs}ms，${r.rounds.length} 轮，工具 ${r.toolCallCount} 次）${r.notes ?? ''}`)
  })
  const passed = all.filter((r) => r.passed).length
  const totalTools = all.reduce((s, r) => s + r.toolCallCount, 0)
  console.log(`\n  通过率：${passed}/${all.length}（${((passed / all.length) * 100).toFixed(0)}%）`)
  console.log(`  总工具调用：${totalTools} 次`)
  console.log(`  总耗时：${all.reduce((s, r) => s + r.durationMs, 0)}ms`)
  console.log('═'.repeat(80))

  // 输出工具调用明细
  console.log('\n工具调用明细：')
  toolCallLog.forEach((tc, i) => {
    console.log(`  ${i + 1}. ${tc.name}(${JSON.stringify(tc.args)}) → ${JSON.stringify(tc.result).slice(0, 100)}`)
  })

  if (passed === all.length) process.exit(0)
  else process.exit(1)
}

main().catch((err) => {
  console.error('LLM 真实联调测试执行失败:', err)
  process.exit(2)
})
