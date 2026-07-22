/**
 * KeBaiPay 前端视觉测试（v2.1.0）
 *
 * 用法：
 *   cd /workspace/KeBaiPay
 *   npx tsx scripts/frontend-visual-test.ts
 *
 * 设计：
 *  - 用 Playwright + Chromium 加载 public/index.html
 *  - 用 page.route() 拦截所有 /api/* 请求，返回 mock 数据
 *  - 模拟键盘鼠标操作：输入手机号/密码、点击按钮、切换菜单
 *  - 频繁截图：每次操作前后都截图，便于视觉回归
 *  - 检查视觉问题：错误显示、布局错乱、空状态、按钮禁用态
 *
 * 截图保存：scripts/screenshots/ 目录
 */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join, resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'

const PUBLIC_DIR = resolve(__dirname, '..', 'public')
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots')
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true })

// Mock 数据：模拟后端 API 响应
// 注意：后端金额单位为分(fen)，通过 fenToYuan() 转换后以 *Yuan 字段返回给前端
const MOCK_USER = {
  id: 'u-1', phone: '13800000001', email: 'user@kebaipay.com',
  nickname: '测试用户', realNameStatus: 'VERIFIED', riskLevel: 'LOW',
  hasPayPassword: true, createdAt: '2026-07-01 10:00:00',
  status: 'ACTIVE',
}
// 账户：余额单位为分(10000分=100.00元)，前端读 *Yuan 字段
const MOCK_ACCOUNT = {
  id: 'acc-1', userId: 'u-1',
  availableBalance: 10000, frozenBalance: 500, totalBalance: 10500,
  availableBalanceYuan: '100.00', frozenBalanceYuan: '5.00', totalBalanceYuan: '105.00',
}
// 账单：后端返回数组（非 {items}），direction 为 INCOME/EXPENSE，amount 为分，amountYuan 为元字符串
const MOCK_BILLS = [
  { id: 'b1', billNo: 'KB001', type: 'RECHARGE', direction: 'INCOME', amount: 10000, amountYuan: '100.00', counterparty: '微信充值', remark: '充值', status: 'SUCCESS', createdAt: '2026-07-22 10:00:00' },
  { id: 'b2', billNo: 'KB002', type: 'TRANSFER', direction: 'EXPENSE', amount: 2000, amountYuan: '20.00', counterparty: '张三', remark: '咖啡钱', status: 'SUCCESS', createdAt: '2026-07-21 15:30:00' },
  { id: 'b3', billNo: 'KB003', type: 'PAYMENT', direction: 'EXPENSE', amount: 500, amountYuan: '5.00', counterparty: '咖啡店', remark: '咖啡', status: 'SUCCESS', createdAt: '2026-07-22 09:15:00' },
  { id: 'b4', billNo: 'KB004', type: 'RECEIPT', direction: 'INCOME', amount: 3000, amountYuan: '30.00', counterparty: '李四', remark: '还款', status: 'SUCCESS', createdAt: '2026-07-20 14:00:00' },
  { id: 'b5', billNo: 'KB005', type: 'RED_PACKET', direction: 'INCOME', amount: 800, amountYuan: '8.00', counterparty: '红包', remark: '生日红包', status: 'SUCCESS', createdAt: '2026-07-19 20:00:00' },
]
const MOCK_ADMIN_USER = {
  id: 'admin-1', username: 'admin', role: 'SUPER_ADMIN', status: 'ACTIVE',
}
const MOCK_MERCHANT = {
  id: 'm-1', userId: 'u-1', merchantNo: 'M001', merchantName: '测试商铺', status: 'APPROVED',
  payRate: 38, withdrawRate: 50, dailyLimit: 100000, balance: 51000,
}
const MOCK_MERCHANT_DASHBOARD = {
  today: { amountYuan: '5000.00', count: 12 },
  week: { amountYuan: '35000.00', count: 89 },
  month: { amountYuan: '150000.00', count: 342 },
}
const MOCK_ADMIN_DASHBOARD = {
  totalUsers: 1280, totalMerchants: 56, todayOrders: 342,
  pendingWithdrawals: 5, pendingMerchants: 3,
}
const MOCK_ADMIN_FINANCE = {
  totalTurnoverYuan: '1000000.00', netIncomeYuan: '800000.00',
  totalFeeYuan: '20000.00', totalAssetsYuan: '5000000.00', transactionCount: 5678,
}
const MOCK_MERCHANT_ORDERS = [
  { id: 'po-1', orderNo: 'PO001', amount: 5000, amountYuan: '50.00', status: 'SUCCESS', buyerName: '李四', createdAt: '2026-07-22 10:00:00' },
  { id: 'po-2', orderNo: 'PO002', amount: 8800, amountYuan: '88.00', status: 'SUCCESS', buyerName: '王五', createdAt: '2026-07-22 11:30:00' },
]
// 风控事件：后端返回数组（非 {items}），需要 handled 字段
const MOCK_RISK_EVENTS = [
  { id: 'r1', level: 'HIGH', type: 'LARGE_TRANSFER', userId: 'u1', description: '单笔转账 5 万', createdAt: '2026-07-22 08:00:00', handled: false },
  { id: 'r2', level: 'MEDIUM', type: 'FREQUENT_LOGIN', userId: 'u2', description: '12 次登录失败', createdAt: '2026-07-22 09:30:00', handled: false },
]

// 已知的 API 路由前缀（匹配后端实际 @Controller 路径，无 /api 前缀）
const API_PREFIXES = [
  '/auth/', '/users/', '/accounts/', '/bills', '/merchants/', '/transfers/',
  '/withdrawals/', '/recharge/', '/red-packets/', '/coupons/', '/qr-codes/',
  '/bank-cards/', '/transactions/', '/splits/', '/subscriptions/', '/cashier/',
  '/escrow/', '/referrals/', '/messages/', '/sms/', '/metrics/', '/health/',
  '/admin/', '/webhooks/', '/open-api/', '/batch-transfers/', '/invoices/',
  '/agent/',
]

function isApiPath(url: string): boolean {
  const path = url.split('?')[0]
  return API_PREFIXES.some((p) => path.startsWith(p))
}

// API mock 路由表
// 注意：前端 API_BASE=''，直接调用 /auth/login 等路径（后端无 setGlobalPrefix）
// 关键：bills 和 risk-events 返回数组（非 {items}），account 带 *Yuan 字段
function mockApiRoute(path: string, method: string, body: any): { status: number; data: any } {
  console.log(`  [mock API] ${method} ${path}`)
  // /auth/login
  if (path === '/auth/login' && method === 'POST') {
    return { status: 200, data: { token: 'mock-jwt-token-test-user', user: MOCK_USER } }
  }
  if (path === '/auth/register' && method === 'POST') {
    return { status: 201, data: { id: 'u-new', phone: body?.phone } }
  }
  if (path === '/auth/admin/login' && method === 'POST') {
    return { status: 200, data: { token: 'mock-jwt-token-admin', admin: MOCK_ADMIN_USER } }
  }
  // 用户
  if (path === '/users/me') return { status: 200, data: MOCK_USER }
  if (path.startsWith('/users/login-logs')) return { status: 200, data: [] }
  if (path === '/accounts/me') return { status: 200, data: MOCK_ACCOUNT }
  // 账单：返回数组（后端 bills.controller 直接 return bills.map(...)）
  if (path.startsWith('/bills') && method === 'GET') return { status: 200, data: MOCK_BILLS }
  // 商户
  if (path === '/merchants/me') return { status: 200, data: MOCK_MERCHANT }
  if (path === '/merchants/dashboard') return { status: 200, data: MOCK_MERCHANT_DASHBOARD }
  if (path.startsWith('/merchants/me/orders')) return { status: 200, data: { items: MOCK_MERCHANT_ORDERS, total: 2 } }
  if (path === '/merchants/me/balance') return { status: 200, data: MOCK_MERCHANT }
  if (path.startsWith('/merchants/qrcodes')) return { status: 200, data: [] }
  if (path.startsWith('/merchants/apps')) return { status: 200, data: [] }
  // 管理后台仪表盘
  if (path === '/admin/dashboard') return { status: 200, data: MOCK_ADMIN_DASHBOARD }
  // 风险事件：返回数组（前端 list.length / list.map）
  if (path.startsWith('/admin/risk-events')) return { status: 200, data: MOCK_RISK_EVENTS }
  if (path.startsWith('/admin/risk-rules')) return { status: 200, data: [] }
  // 财务概览
  if (path.startsWith('/admin/finance/overview')) return { status: 200, data: MOCK_ADMIN_FINANCE }
  if (path.startsWith('/admin/finance')) return { status: 200, data: MOCK_ADMIN_FINANCE }
  // 管理后台列表（分页格式 {items, total, page}）
  if (path.startsWith('/admin/users')) return { status: 200, data: { items: [MOCK_USER], total: 1, page: 1, pageSize: 10 } }
  if (path.startsWith('/admin/merchants')) return { status: 200, data: { items: [MOCK_MERCHANT], total: 1, page: 1, pageSize: 10 } }
  if (path.startsWith('/admin/identity')) return { status: 200, data: { items: [], total: 0, page: 1, pageSize: 20 } }
  if (path.startsWith('/admin/withdrawals')) return { status: 200, data: { items: [], total: 0, page: 1, pageSize: 10 } }
  if (path.startsWith('/admin/payment-orders')) return { status: 200, data: { items: [], total: 0, page: 1, pageSize: 10 } }
  if (path.startsWith('/admin/login-logs')) return { status: 200, data: { items: [], total: 0, page: 1, pageSize: 20 } }
  if (path.startsWith('/admin/audit-logs')) return { status: 200, data: { items: [], total: 0, page: 1, pageSize: 20 } }
  if (path.startsWith('/admin/system-config')) return { status: 200, data: [] }
  if (path.startsWith('/admin/reconciliation')) return { status: 200, data: { items: [], total: 0 } }
  if (path.startsWith('/admin/channels')) return { status: 200, data: [] }
  // 对账
  if (path.startsWith('/cashier/orders/reconciliation')) return { status: 200, data: { items: [], total: 0, matched: 0, unmatched: 0 } }
  // 红包
  if (path.startsWith('/red-packets')) return { status: 200, data: [] }
  // 二维码
  if (path.startsWith('/qr-codes')) return { status: 200, data: [] }
  // 默认
  return { status: 200, data: { success: true } }
}

// 启动静态文件服务器（serve public/ 目录）
async function startStaticServer(port: number): Promise<{ close: () => void }> {
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  }
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = req.url || '/'
        // 处理 API mock（匹配后端实际路由，无 /api 前缀）
        if (isApiPath(url)) {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const bodyStr = Buffer.concat(chunks).toString()
          const body = bodyStr ? JSON.parse(bodyStr) : {}
          const { status, data } = mockApiRoute(url, req.method || 'GET', body)
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
          return
        }
        // 静态文件
        let filePath = url === '/' ? '/index.html' : url
        filePath = join(PUBLIC_DIR, filePath)
        if (!existsSync(filePath)) {
          // SPA fallback
          filePath = join(PUBLIC_DIR, 'index.html')
        }
        const content = await readFile(filePath)
        const ext = extname(filePath)
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
        res.end(content)
      } catch (err: any) {
        console.error(`  [static server] error: ${err.message}`)
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    })
    server.listen(port, () => {
      console.log(`  [static server] 启动 http://localhost:${port}`)
      resolve({ close: () => server.close() })
    })
    server.on('error', reject)
  })
}

interface VisualIssue {
  route: string
  description: string
  severity: 'critical' | 'warning' | 'minor'
}

async function main() {
  console.log('╔' + '═'.repeat(78) + '╗')
  console.log('║  KeBaiPay v2.1.0 前端视觉测试（Playwright）                                       ║')
  console.log('╚' + '═'.repeat(78) + '╝')

  // 启动静态服务器
  const PORT = 8090
  const server = await startStaticServer(PORT)

  // 启动 Chromium
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  })
  // 拦截 console
  const consoleLogs: string[] = []
  const page = await context.newPage()
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`))

  const visualIssues: VisualIssue[] = []
  let stepCounter = 0

  async function snap(name: string) {
    stepCounter++
    const filename = `${String(stepCounter).padStart(2, '0')}-${name}.png`
    const filepath = join(SCREENSHOT_DIR, filename)
    await page.screenshot({ path: filepath, fullPage: true })
    console.log(`  📸 截图 ${filename}`)
    return filepath
  }

  async function visitRoute(route: string, name: string) {
    console.log(`\n▶ 访问 #${route}`)
    await page.evaluate((r) => { window.location.hash = r }, route)
    await page.waitForTimeout(800)  // 等渲染
    await snap(name)
    // 收集 console 错误
    const routeErrors = consoleLogs.filter((l) => l.includes('[error]') || l.includes('pageerror'))
    if (routeErrors.length > 0) {
      visualIssues.push({ route, description: `JS 错误: ${routeErrors[0].slice(0, 100)}`, severity: 'warning' })
    }
  }

  async function clickElement(selector: string, name: string) {
    try {
      await page.click(selector, { timeout: 3000 })
      await page.waitForTimeout(500)
      await snap(name)
    } catch (err: any) {
      console.log(`  ⚠️ 点击 ${selector} 失败: ${err.message}`)
      visualIssues.push({ route: page.url(), description: `点击失败 ${selector}`, severity: 'warning' })
    }
  }

  async function typeInput(selector: string, text: string, name: string) {
    try {
      await page.fill(selector, text)
      await page.waitForTimeout(200)
      await snap(name)
    } catch (err: any) {
      console.log(`  ⚠️ 输入 ${selector} 失败: ${err.message}`)
      visualIssues.push({ route: page.url(), description: `输入失败 ${selector}`, severity: 'warning' })
    }
  }

  try {
    // ============ 1. 加载首页 ============
    console.log('\n=== 阶段 1：初始加载 ===')
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(500)
    await snap('initial-load')
    const title = await page.title()
    console.log(`  页面标题: ${title}`)

    // ============ 2. 登录页 - 模拟键盘输入 ============
    console.log('\n=== 阶段 2：登录页键盘鼠标交互 ===')
    await page.evaluate(() => { window.location.hash = 'login' })
    await page.waitForTimeout(500)
    await snap('login-empty')

    // 模拟键盘输入手机号
    await typeInput('#credential', '13800000001', 'login-typed-phone')
    // 模拟键盘输入密码
    await typeInput('#password', 'Test1234!', 'login-typed-password')
    // 模拟鼠标点击"记住我"
    await clickElement('#rememberMe', 'login-remember-checked')
    // 模拟鼠标点击登录按钮
    console.log('  🖱️ 点击登录按钮')
    await page.click('#btnLogin')
    await page.waitForTimeout(1500)  // 等登录请求
    await snap('login-after-click')

    // 检查是否登录成功
    const hash = await page.evaluate(() => window.location.hash)
    console.log(`  当前 hash: ${hash}`)
    if (!hash.includes('home')) {
      visualIssues.push({ route: 'login', description: '登录后未跳转到 home', severity: 'critical' })
    }

    // ============ 3. 登录后 - 浏览所有路由 ============
    console.log('\n=== 阶段 3：浏览 C 端路由（登录态） ===')
    await visitRoute('home', 'page-home')
    await visitRoute('wallet', 'page-wallet')
    await visitRoute('transfer', 'page-transfer')
    await visitRoute('recharge', 'page-recharge')
    await visitRoute('withdraw', 'page-withdraw')
    await visitRoute('redpacket', 'page-redpacket')
    await visitRoute('qrcode', 'page-qrcode')
    await visitRoute('bills', 'page-bills')
    await visitRoute('identity', 'page-identity')
    await visitRoute('profile', 'page-profile')
    await visitRoute('security', 'page-security')
    await visitRoute('bankCards', 'page-bankcards')
    await visitRoute('help', 'page-help')

    // ============ 4. 商户路由 ============
    console.log('\n=== 阶段 4：浏览 B 端商户路由 ===')
    await visitRoute('merchantRegister', 'page-merchant-register')
    await visitRoute('merchantDashboard', 'page-merchant-dashboard')
    await visitRoute('merchantQrCodes', 'page-merchant-qrcodes')
    await visitRoute('merchantReconciliation', 'page-merchant-recon')
    await visitRoute('merchantApps', 'page-merchant-apps')
    await visitRoute('cashier', 'page-cashier')

    // ============ 5. 管理端路由 ============
    console.log('\n=== 阶段 5：浏览 A 端管理后台路由 ===')
    // 先访问 adminLogin
    await visitRoute('adminLogin', 'page-admin-login')
    // 模拟管理员登录
    await page.fill('#username', 'admin').catch(() => {})
    await page.fill('#password', 'Admin2026').catch(() => {})
    await snap('admin-login-typed')
    // 直接设置 token 进入管理端（前端读 'adminToken' 键）
    await page.evaluate(() => {
      localStorage.setItem('adminToken', 'mock-admin-token')
    })
    await visitRoute('adminDashboard', 'page-admin-dashboard')
    await visitRoute('adminUsers', 'page-admin-users')
    await visitRoute('adminMerchants', 'page-admin-merchants')
    await visitRoute('adminIdentity', 'page-admin-identity')
    await visitRoute('adminWithdrawals', 'page-admin-withdrawals')
    await visitRoute('adminRiskEvents', 'page-admin-risk-events')
    await visitRoute('adminRiskRules', 'page-admin-risk-rules')
    await visitRoute('adminLoginLogs', 'page-admin-login-logs')
    await visitRoute('adminAuditLogs', 'page-admin-audit-logs')
    await visitRoute('adminConfigs', 'page-admin-configs')
    await visitRoute('adminOrders', 'page-admin-orders')
    await visitRoute('adminFinance', 'page-admin-finance')
    await visitRoute('adminReconciliation', 'page-admin-recon')
    await visitRoute('adminChannels', 'page-admin-channels')

    // ============ 6. 复杂场景：C 端用户完整转账流程 ============
    console.log('\n=== 阶段 6：复杂场景 - C 端用户转账/充值流程 ===')
    // 回到首页，模拟真实用户操作
    await page.evaluate(() => { window.location.hash = 'home' })
    await page.waitForTimeout(800)
    await snap('complex-home-loaded')

    // 检查余额显示是否正确
    const balanceText = await page.evaluate(() => {
      const el = document.querySelector('.kb-balance-amount')
      return el ? el.textContent : null
    })
    console.log(`  首页余额显示: ${balanceText}`)
    if (!balanceText || balanceText.includes('null') || balanceText.includes('undefined')) {
      visualIssues.push({ route: 'home', description: '首页余额未正确显示', severity: 'critical' })
    }

    // 点击"转账"快捷按钮
    console.log('  🖱️ 点击转账快捷入口')
    await page.evaluate(() => { window.location.hash = 'transfer' })
    await page.waitForTimeout(800)
    await snap('complex-transfer-page')

    // 查找转账表单输入框
    const transferInputs = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea'))
      return inputs.map(i => ({ id: i.id, name: i.name, placeholder: i.placeholder, type: i.type }))
    })
    console.log(`  转账页表单字段: ${JSON.stringify(transferInputs)}`)

    // 模拟填写转账表单（尝试多种选择器）
    const transferSelectors = transferInputs.filter(i => i.type !== 'checkbox' && i.type !== 'radio')
    for (const inp of transferSelectors.slice(0, 3)) {
      const sel = inp.id ? `#${inp.id}` : `[name="${inp.name}"]`
      const testVal = inp.placeholder?.includes('金额') ? '100' : inp.placeholder?.includes('备注') ? '测试转账' : '13800000002'
      try {
        await page.fill(sel, testVal)
        await page.waitForTimeout(200)
      } catch {}
    }
    await snap('complex-transfer-filled')

    // 检查转账页是否有提交按钮
    const transferBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const submitBtn = btns.find(b => /转账|确认|提交|下一步/.test(b.textContent || ''))
      return submitBtn ? { id: submitBtn.id, text: submitBtn.textContent, disabled: submitBtn.disabled } : null
    })
    console.log(`  转账提交按钮: ${JSON.stringify(transferBtn)}`)

    // 查看账单页
    await page.evaluate(() => { window.location.hash = 'bills' })
    await page.waitForTimeout(800)
    await snap('complex-bills-page')
    // 检查账单列表是否渲染
    const billItems = await page.evaluate(() => {
      const items = document.querySelectorAll('.kb-txn-item, [class*="bill"], [class*="txn"]')
      return items.length
    })
    console.log(`  账单列表项数: ${billItems}`)
    if (billItems === 0) {
      visualIssues.push({ route: 'bills', description: '账单页无数据项显示（空状态可能未处理）', severity: 'warning' })
    }

    // 充值流程
    await page.evaluate(() => { window.location.hash = 'recharge' })
    await page.waitForTimeout(800)
    await snap('complex-recharge-page')
    // 尝试点击金额快捷选项
    const rechargeAmountClicked = await page.evaluate(() => {
      const amounts = Array.from(document.querySelectorAll('[class*="amount"], [data-amount], .kb-amount-chip, button'))
      const target = amounts.find(a => /100|500|1000/.test(a.textContent || ''))
      if (target) { (target as HTMLElement).click(); return true }
      return false
    })
    if (rechargeAmountClicked) {
      await page.waitForTimeout(300)
      await snap('complex-recharge-amount-selected')
    }

    // ============ 7. 复杂场景：B 端商户完整操作 ============
    console.log('\n=== 阶段 7：复杂场景 - B 端商户操作 ===')
    await page.evaluate(() => { window.location.hash = 'merchantDashboard' })
    await page.waitForTimeout(800)
    await snap('complex-merchant-dashboard')

    // 检查商户仪表盘统计数据
    const merchantStats = await page.evaluate(() => {
      const nums = Array.from(document.querySelectorAll('[class*="stat"], [class*="amount"], [class*="balance"]'))
      return nums.slice(0, 5).map(n => n.textContent?.trim())
    })
    console.log(`  商户仪表盘统计: ${JSON.stringify(merchantStats)}`)

    // 商户订单页
    await page.evaluate(() => { window.location.hash = 'merchantQrCodes' })
    await page.waitForTimeout(800)
    await snap('complex-merchant-qrcodes')

    // 商户对账页
    await page.evaluate(() => { window.location.hash = 'merchantReconciliation' })
    await page.waitForTimeout(800)
    await snap('complex-merchant-recon')

    // ============ 8. 复杂场景：A 端管理员风控/财务 ============
    console.log('\n=== 阶段 8：复杂场景 - A 端管理员风控审计 ===')
    await page.evaluate(() => { window.location.hash = 'adminRiskEvents' })
    await page.waitForTimeout(800)
    await snap('complex-admin-risk-events')

    // 检查风控事件列表
    const riskEventRows = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr, [class*="row"], [class*="event"], [class*="item"]')
      return rows.length
    })
    console.log(`  风控事件行数: ${riskEventRows}`)

    // 财务统计页
    await page.evaluate(() => { window.location.hash = 'adminFinance' })
    await page.waitForTimeout(800)
    await snap('complex-admin-finance')
    const financeData = await page.evaluate(() => {
      const nums = Array.from(document.querySelectorAll('[class*="stat"], [class*="amount"], [class*="total"], [class*="revenue"]'))
      return nums.slice(0, 5).map(n => n.textContent?.trim())
    })
    console.log(`  财务统计数据: ${JSON.stringify(financeData)}`)

    // ============ 9. 视觉问题深度检查 ============
    console.log('\n=== 阶段 9：视觉问题深度检查 ===')
    // 检查关键页面的核心元素
    await page.evaluate(() => { window.location.hash = 'home' })
    await page.waitForTimeout(500)
    await snap('final-home-check')

    // 检查是否有空白页（app 容器无内容）
    const appContent = await page.evaluate(() => document.getElementById('app')?.innerHTML?.length || 0)
    if (appContent < 100) {
      visualIssues.push({ route: 'home', description: '首页 app 容器内容过短，可能渲染失败', severity: 'critical' })
    }

    // 检查是否有 alert 错误
    const alertVisible = await page.evaluate(() => {
      const t = document.getElementById('kb-toast-container')
      return t && t.children.length > 0 ? t.children[0].textContent : null
    })
    if (alertVisible && alertVisible.includes('失败')) {
      visualIssues.push({ route: 'home', description: `首页 toast 错误: ${alertVisible}`, severity: 'warning' })
    }

    // 检查文本溢出（水平滚动条出现）
    // 排除 overflow:hidden 的元素（伪元素装饰已被裁剪，非真实溢出）
    const overflowIssues = await page.evaluate(() => {
      const issues: string[] = []
      document.querySelectorAll('*').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 50) {
          const style = getComputedStyle(el)
          if (style.overflowX === 'hidden' || style.overflow === 'hidden') return
          const tag = el.tagName + (el.id ? `#${el.id}` : '') + (el.className ? `.${String(el.className).split(' ')[0]}` : '')
          issues.push(tag)
        }
      })
      return issues.slice(0, 5)
    })
    if (overflowIssues.length > 0) {
      visualIssues.push({ route: 'multiple', description: `文本溢出元素: ${overflowIssues.join(', ')}`, severity: 'minor' })
    }

    // 检查空 img src
    const emptyImgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).filter(img => !img.src || img.src.endsWith('/')).length
    })
    if (emptyImgs > 0) {
      visualIssues.push({ route: 'home', description: `${emptyImgs} 个图片 src 为空`, severity: 'minor' })
    }

  } catch (err: any) {
    console.error('视觉测试执行错误:', err.message)
    visualIssues.push({ route: page.url(), description: `执行错误: ${err.message}`, severity: 'critical' })
  } finally {
    // ============ 7. 汇总 ============
    console.log('\n' + '═'.repeat(80))
    console.log('  视觉测试汇总')
    console.log('═'.repeat(80))
    console.log(`  截图数量：${stepCounter} 张（保存于 scripts/screenshots/）`)
    console.log(`  视觉问题：${visualIssues.length} 个`)
    if (visualIssues.length > 0) {
      console.log('\n  问题明细：')
      visualIssues.forEach((issue, i) => {
        console.log(`    ${i + 1}. [${issue.severity}] #${issue.route} - ${issue.description}`)
      })
    } else {
      console.log('  ✅ 没有发现视觉问题')
    }
    console.log('═'.repeat(80))

    // 输出 console 日志摘要
    if (consoleLogs.length > 0) {
      console.log('\n浏览器 console 日志（最后 20 条）：')
      consoleLogs.slice(-20).forEach((l) => console.log(`  ${l}`))
    }

    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error('前端视觉测试执行失败:', err)
  process.exit(2)
})
