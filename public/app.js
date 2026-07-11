// 自动检测部署路径，支持反代子路径部署
(function() {
  const baseEl = document.getElementById('app-base')
  if (baseEl) {
    // 检测当前页面所在路径
    const path = window.location.pathname
    // 如果不在根路径，自动调整 base href
    const match = path.match(/^(\/[^\/]+\/?)index\.html$/)
    if (match) {
      baseEl.href = match[1]
    }
  }
})()

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const API_BASE = ''
const app = document.getElementById('app')

let token = localStorage.getItem('kebaipay_token')
let currentUser = null
let currentAccount = null

// 路由
const routes = {
  login: renderLogin,
  register: renderRegister,
  home: renderHome,
  wallet: renderWallet,
  transfer: renderTransfer,
  recharge: renderRecharge,
  withdraw: renderWithdraw,
  redpacket: renderRedPacket,
  qrcode: renderQrCode,
  payByQr: renderPayByQr,
  bills: renderBills,
  billDetail: renderBillDetail,
  identity: renderIdentity,
  resetPayPassword: renderResetPayPassword,
  profile: renderProfile,
  security: renderSecurity,
  merchantRegister: renderMerchantRegister,
  merchantDashboard: renderMerchantDashboard,
  merchantQrCodes: renderMerchantQrCodes,
  merchantReconciliation: renderMerchantReconciliation,
  merchantAdmin: renderMerchantAdmin,
  cashier: renderCashier,
  merchantApps: renderMerchantApps,
  bankCards: renderBankCards,
  help: renderHelp,
  scan: renderScan,
  adminLogin: renderAdminLogin,
  adminDashboard: renderAdminDashboard,
  adminUsers: renderAdminUsers,
  adminMerchants: renderAdminMerchants,
  adminIdentity: renderAdminIdentity,
  adminWithdrawals: renderAdminWithdrawals,
  adminRiskEvents: renderAdminRiskEvents,
  adminRiskRules: renderAdminRiskRules,
  adminLoginLogs: renderAdminLoginLogs,
  adminAuditLogs: renderAdminAuditLogs,
  adminConfigs: renderAdminConfigs,
  adminOrders: renderAdminOrders,
  adminFinance: renderAdminFinance,
  adminReconciliation: renderAdminReconciliation,
  adminChannels: renderAdminChannels,
}

function navigate(page) {
  window.location.hash = page
}

function render() {
  const hash = window.location.hash.replace('#', '') || 'home'
  const page = hash.split('?')[0]
  const fn = routes[page] || renderHome
  fn()
}

window.addEventListener('hashchange', render)
window.addEventListener('load', render)

// 全局 Toast 提示（替代 alert）
function showToast(message, type = 'info') {
  const existing = document.getElementById('kb-toast-container')
  let container = existing
  if (!container) {
    container = document.createElement('div')
    container.id = 'kb-toast-container'
    container.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none'
    document.body.appendChild(container)
  }
  const toast = document.createElement('div')
  const bg = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#1e3a8a'
  toast.style.cssText = `background:${bg};color:#fff;padding:12px 24px;border-radius:12px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.2);opacity:0;transform:translateY(-10px);transition:all 0.3s;max-width:320px;text-align:center;word-break:break-word`
  toast.textContent = message
  container.appendChild(toast)
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)' })
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-10px)'
    setTimeout(() => toast.remove(), 300)
  }, 2500)
}

// HTTP 请求
async function api(path, options = {}) {
  const url = `${API_BASE}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, {
    ...options,
    headers,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // 401: token 过期或无效，清除登录态并跳转登录页
    if (res.status === 401) {
      localStorage.removeItem('kebaipay_token')
      sessionStorage.removeItem('kebaipay_token')
      token = null
      if (!window.location.hash.includes('login')) {
        navigate('login')
      }
    }
    throw new Error(data?.message || `请求失败 ${res.status}`)
  }
  return data
}

async function adminApi(path, options = {}) {
  const url = `${API_BASE}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  const adminToken = localStorage.getItem('adminToken')
  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`
  }
  const res = await fetch(url, {
    ...options,
    headers,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // 401: 管理员 token 过期或无效，清除登录态并跳转管理员登录页
    if (res.status === 401) {
      localStorage.removeItem('adminToken')
      if (!window.location.hash.includes('adminLogin')) {
        navigate('adminLogin')
      }
    }
    throw new Error(data?.message || `请求失败 ${res.status}`)
  }
  return data
}

function fmtMoney(yuan) {
  return Number(yuan || 0).toFixed(2)
}

// 从当前 hash 中解析 query 参数对象，hash 形如 #adminAuditLogs?page=2&limit=10&action=login
function getHashParamObj() {
  const hash = window.location.hash.replace(/^#/, '')
  const idx = hash.indexOf('?')
  if (idx < 0) return {}
  const params = new URLSearchParams(hash.slice(idx + 1))
  const obj = {}
  params.forEach((v, k) => { obj[k] = v })
  return obj
}

// 跳转到指定 page，保留当前 hash 中的其他 query 参数
function navigateWithParams(page, overrides = {}) {
  const hash = window.location.hash.replace(/^#/, '')
  const routeName = hash.split('?')[0] || 'home'
  const existing = getHashParamObj()
  const merged = { ...existing, ...overrides, page: String(page) }
  // 清理空值
  Object.keys(merged).forEach((k) => {
    if (merged[k] === '' || merged[k] == null) delete merged[k]
  })
  // 首页不显示 page=1
  if (page === 1 && merged.page) {
    // 保留显式 page=1 也可，但若用户已无其他参数则去掉
  }
  const qs = new URLSearchParams(merged).toString()
  window.location.hash = qs ? `${routeName}?${qs}` : routeName
}

// 通用分页控件：传入 total / page / limit / onPage(page => void)
function renderPagination(total, page, limit, onPage) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  if (totalPages <= 1) return ''
  const cur = Math.min(Math.max(1, page), totalPages)
  const btns = []
  // 上一页
  btns.push(`<button class="btn btn-secondary" style="margin:0 4px;min-width:auto;padding:6px 12px" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>上一页</button>`)
  // 页码（最多显示 5 个，居中当前页）
  const start = Math.max(1, cur - 2)
  const end = Math.min(totalPages, start + 4)
  for (let i = start; i <= end; i++) {
    btns.push(`<button class="btn ${i === cur ? 'btn-primary' : 'btn-secondary'}" style="margin:0 4px;min-width:auto;padding:6px 12px" data-page="${i}">${i}</button>`)
  }
  // 下一页
  btns.push(`<button class="btn btn-secondary" style="margin:0 4px;min-width:auto;padding:6px 12px" data-page="${cur + 1}" ${cur === totalPages ? 'disabled' : ''}>下一页</button>`)
  return `
    <div style="display:flex;justify-content:center;align-items:center;margin-top:16px;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--kb-text-secondary);margin-right:8px">共 ${total} 条 / ${totalPages} 页</span>
      ${btns.join('')}
    </div>
  `
}

// 绑定分页控件点击
function bindPagination(onPage) {
  document.querySelectorAll('[data-page]').forEach((el) => {
    el.onclick = () => {
      if (el.disabled) return
      const p = Number(el.getAttribute('data-page'))
      if (!p || p < 1) return
      onPage(p)
    }
  })
}

function fmtType(type) {
  const map = {
    RECHARGE: '充值',
    WITHDRAW: '提现',
    TRANSFER: '转账',
    RECEIPT: '收款',
    PAYMENT: '消费',
    REFUND: '退款',
    RED_PACKET: '红包',
  }
  return map[type] || type
}

const ICONS = {
  recharge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16l-4-4m0 0l4-4m-4 4h18"/><path d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  payment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  refund: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  redpacket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  bill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M8 15h4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  qrcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 6 12 3 19 6"/><line x1="4" y1="10" x2="4" y2="21"/><line x1="20" y1="10" x2="20" y2="21"/><line x1="9" y1="14" x2="9" y2="18"/><line x1="15" y1="14" x2="15" y2="18"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  idCard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 15h10"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
}

function icon(name, size) {
  const s = size || 20
  const svg = ICONS[name] || ICONS.empty
  return svg.replace('<svg', `<svg width="${s}" height="${s}"`)
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 身份证号脱敏：保留前 3 位和后 4 位，中间用星号
function maskIdCard(idCard) {
  if (!idCard) return ''
  const s = String(idCard)
  if (s.length <= 7) return s.replace(/.(?=.{1})/g, '*')
  return s.slice(0, 3) + '*'.repeat(s.length - 7) + s.slice(-4)
}

// 通用弹窗，返回 { close } 用于手动关闭
function showModal(title, bodyHtml) {
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px'
  const modal = document.createElement('div')
  modal.className = 'card'
  modal.style.cssText = 'max-width:420px;width:100%;max-height:80vh;overflow:auto'
  modal.innerHTML = `
    <div class="section-title">${title}</div>
    ${bodyHtml}
    <button class="btn btn-secondary" id="btnCloseModal" style="margin-top:12px">关闭</button>
  `
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  document.getElementById('btnCloseModal').onclick = close
  overlay.onclick = (e) => {
    if (e.target === overlay) close()
  }
  return { close }
}

// 带 token 下载 CSV 文件
async function downloadCsv(url) {
  try {
    const res = await fetch(`${API_BASE}${url}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.message || `下载失败 ${res.status}`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'orders.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
}

// 带 admin token 下载 CSV 文件
async function downloadAdminCsv(url, filename) {
  try {
    const adminToken = localStorage.getItem('adminToken')
    const res = await fetch(`${API_BASE}${url}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.message || `下载失败 ${res.status}`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename || 'export.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
}

// 登录页
function renderLogin() {
  app.innerHTML = `
    <div class="page" style="display:flex;flex-direction:column;min-height:100vh;padding:0;background:#fff">
      <div style="flex:1;display:flex;flex-direction:column;padding:48px 24px 32px;max-width:420px;width:100%;margin:0 auto">
        <div style="text-align:center;margin-bottom:36px">
          <div style="width:64px;height:64px;border-radius:16px;background:var(--kb-primary-gradient);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px;box-shadow:0 8px 24px rgba(30,64,175,0.25);position:relative">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div style="font-size:24px;font-weight:700;color:var(--kb-text);margin-bottom:6px;letter-spacing:1px">科佰支付</div>
          <div style="font-size:13px;color:var(--kb-text-tertiary);letter-spacing:2px">KEBAIPAY</div>
        </div>

        <div>
          <div id="loginError" style="display:none;background:var(--kb-error-light);border:1px solid #fecaca;color:var(--kb-error);padding:10px 14px;border-radius:var(--kb-radius-sm);font-size:13px;margin-bottom:16px"></div>

          <div class="form-group" style="margin-bottom:18px">
            <label class="form-label" style="font-weight:500;margin-bottom:8px">手机号 / 邮箱</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('user', 18)}</span>
              <input class="form-input" id="credential" placeholder="请输入手机号或邮箱" autocomplete="username" style="padding-left:42px;height:48px;font-size:15px;background:var(--kb-bg)">
            </div>
          </div>

          <div class="form-group" style="margin-bottom:16px">
            <label class="form-label" style="font-weight:500;margin-bottom:8px">登录密码</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
              <input class="form-input" id="password" type="password" placeholder="请输入登录密码" autocomplete="current-password" style="padding-left:42px;padding-right:46px;height:48px;font-size:15px;background:var(--kb-bg)">
              <button type="button" id="togglePassword" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;-webkit-user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eyeOff', 18)}</button>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--kb-text-secondary);cursor:pointer;user-select:none;-webkit-user-select:none">
              <input type="checkbox" id="rememberMe" style="width:15px;height:15px;accent-color:var(--kb-primary);cursor:pointer;border-radius:4px">
              记住我
            </label>
            <a href="#resetPayPassword" style="font-size:13px;color:var(--kb-primary);text-decoration:none;font-weight:500">忘记密码？</a>
          </div>

          <button class="btn btn-primary" id="btnLogin" style="height:50px;font-size:15px;font-weight:600;border-radius:var(--kb-radius-sm);letter-spacing:2px">
            <span id="loginBtnText">登 录</span>
            <span id="loginBtnLoading" style="display:none">
              <span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span>
            </span>
          </button>

          <div style="display:flex;align-items:center;gap:12px;margin:20px 0">
            <div style="flex:1;height:1px;background:var(--kb-border)"></div>
            <span style="font-size:12px;color:var(--kb-text-tertiary)">还没有账号？</span>
            <div style="flex:1;height:1px;background:var(--kb-border)"></div>
          </div>

          <button class="btn btn-secondary" id="btnGoRegister" style="height:46px;font-size:14px;font-weight:500;border:1.5px solid var(--kb-border)">注册新账号</button>
        </div>

        <div style="flex:1"></div>
        <div style="text-align:center;padding-top:24px">
          <a href="#adminLogin" style="font-size:12px;color:var(--kb-text-tertiary);text-decoration:none;display:inline-flex;align-items:center;gap:4px;opacity:0.7">
            ${icon('settings', 13)} 管理员入口
          </a>
        </div>
      </div>
    </div>

    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  `

  document.getElementById('togglePassword').onclick = () => {
    const input = document.getElementById('password')
    const btn = document.getElementById('togglePassword')
    if (input.type === 'password') {
      input.type = 'text'
      btn.innerHTML = icon('eye', 18)
    } else {
      input.type = 'password'
      btn.innerHTML = icon('eyeOff', 18)
    }
  }

  function showLoginError(msg) {
    const el = document.getElementById('loginError')
    el.textContent = msg
    el.style.display = 'block'
    el.style.animation = 'none'
    el.offsetHeight
    el.style.animation = 'fadeIn 0.2s ease-out'
  }

  function setLoginLoading(loading) {
    document.getElementById('btnLogin').disabled = loading
    document.getElementById('loginBtnText').style.display = loading ? 'none' : 'inline'
    document.getElementById('loginBtnLoading').style.display = loading ? 'inline' : 'none'
  }

  document.getElementById('btnLogin').onclick = async () => {
    const credential = document.getElementById('credential').value.trim()
    const password = document.getElementById('password').value
    const rememberMe = document.getElementById('rememberMe').checked
    document.getElementById('loginError').style.display = 'none'

    if (!credential) { showLoginError('请输入手机号或邮箱'); return }
    if (!password) { showLoginError('请输入密码'); return }

    const body = { password }
    if (credential.includes('@')) body.email = credential
    else body.phone = credential

    setLoginLoading(true)
    try {
      const res = await api('/auth/login', { method: 'POST', body: JSON.stringify(body) })
      token = res.token
      if (rememberMe) {
        localStorage.setItem('kebaipay_token', token)
      } else {
        sessionStorage.setItem('kebaipay_token', token)
      }
      navigate('home')
    } catch (e) {
      showLoginError(e.message)
      setLoginLoading(false)
    }
  }
  document.getElementById('btnGoRegister').onclick = () => navigate('register')
}

// 注册页
function renderRegister() {
  let currentStep = 1

  function getStrengthLevel(pwd) {
    let score = 0
    if (pwd.length >= 8) score++
    if (pwd.length >= 12) score++
    if (/[A-Z]/.test(pwd)) score++
    if (/[a-z]/.test(pwd)) score++
    if (/[0-9]/.test(pwd)) score++
    if (/[^A-Za-z0-9]/.test(pwd)) score++
    if (score <= 2) return 0
    if (score <= 3) return 1
    if (score <= 4) return 2
    return 3
  }

  function renderStepIndicator(activeStep) {
    const steps = ['基本信息', '设置密码', '完成']
    return `
      <div style="display:flex;align-items:center;justify-content:center;margin-bottom:28px;padding:0 8px">
        ${steps.map((s, i) => {
          const stepNum = i + 1
          const isActive = stepNum === activeStep
          const isDone = stepNum < activeStep
          const color = isDone ? 'var(--kb-success)' : isActive ? 'var(--kb-primary)' : 'var(--kb-border)'
          const textColor = isDone ? 'var(--kb-success)' : isActive ? 'var(--kb-primary)' : 'var(--kb-text-secondary)'
          const lineColor = i < steps.length - 1 ? (stepNum < activeStep ? 'var(--kb-success)' : 'var(--kb-border)') : 'transparent'
          return `
            <div style="display:flex;align-items:center;flex:1">
              <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
                <div style="width:28px;height:28px;border-radius:50%;background:${isDone || isActive ? color : 'transparent'};color:#fff;border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;transition:all 0.3s">
                  ${isDone ? icon('check', 14) : stepNum}
                </div>
                <div style="font-size:11px;color:${textColor};margin-top:6px;white-space:nowrap;font-weight:${isActive ? '600' : '400'}">${s}</div>
              </div>
              ${i < steps.length - 1 ? `<div style="flex:1;height:2px;background:${lineColor};margin:0 8px;margin-bottom:18px;transition:background 0.3s"></div>` : ''}
            </div>
          `
        }).join('')}
      </div>
    `
  }

  function renderPasswordStrength(pwd) {
    const level = getStrengthLevel(pwd)
    const labels = ['弱', '中', '强', '非常强']
    const colors = ['var(--kb-error)', 'var(--kb-warning)', 'var(--kb-success)', '#1677ff']
    const bgColors = ['var(--kb-error-light)', 'var(--kb-warning-light)', 'var(--kb-success-light)', 'var(--kb-primary-light)']
    if (!pwd) return ''
    return `
      <div style="margin-top:8px;animation:fadeIn 0.2s ease-out">
        <div style="display:flex;gap:4px;margin-bottom:4px">
          ${[0,1,2,3].map(i => `<div style="flex:1;height:4px;border-radius:2px;background:${i <= level ? colors[level] : 'var(--kb-border)'};transition:background 0.3s"></div>`).join('')}
        </div>
        <div style="font-size:12px;color:${colors[level]}">密码强度：${labels[level]}</div>
      </div>
    `
  }

  function showRegError(msg) {
    const el = document.getElementById('regError')
    if (!el) return
    el.textContent = msg
    el.style.display = 'block'
    el.style.animation = 'none'
    el.offsetHeight
    el.style.animation = 'fadeIn 0.2s ease-out'
  }

  function hideRegError() {
    const el = document.getElementById('regError')
    if (el) el.style.display = 'none'
  }

  function renderStep1() {
    return `
      <div id="regError" style="display:none;background:var(--kb-error-light);border:1px solid #ffccc7;color:#cf1322;padding:10px 14px;border-radius:var(--kb-radius-md);font-size:13px;margin-bottom:16px"></div>
      <div class="form-group">
        <label class="form-label">昵称</label>
        <input class="form-input" id="regNickname" placeholder="请输入昵称" maxlength="20">
      </div>
      <div class="form-group">
        <label class="form-label">手机号 <span style="color:var(--kb-error)">*</span></label>
        <div style="position:relative">
          <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('phone', 18)}</span>
          <input class="form-input" id="regPhone" placeholder="请输入手机号" maxlength="11" inputmode="numeric" style="padding-left:42px">
        </div>
        <div id="phoneHint" style="font-size:12px;color:var(--kb-text-secondary);margin-top:4px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">邮箱 <span style="color:var(--kb-text-tertiary)">(选填)</span></label>
        <div style="position:relative">
          <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('mail', 18)}</span>
          <input class="form-input" id="regEmail" placeholder="请输入邮箱" style="padding-left:42px">
        </div>
      </div>
      <button class="btn btn-primary" id="btnRegNext" style="margin-top:8px">下一步</button>
    `
  }

  function renderStep2() {
    return `
      <div id="regError" style="display:none;background:var(--kb-error-light);border:1px solid #ffccc7;color:#cf1322;padding:10px 14px;border-radius:var(--kb-radius-md);font-size:13px;margin-bottom:16px"></div>
      <div class="form-group">
        <label class="form-label">登录密码</label>
        <div style="position:relative">
          <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
          <input class="form-input" id="regPassword" type="password" placeholder="请输入登录密码" autocomplete="new-password" style="padding-left:42px;padding-right:46px">
          <button type="button" id="toggleRegPassword" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;-webkit-user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eye', 18)}</button>
        </div>
        <div id="passwordStrength"></div>
      </div>
      <div style="background:var(--kb-bg);border-radius:var(--kb-radius-md);padding:14px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:600;color:var(--kb-text);margin-bottom:8px">密码要求：</div>
        <div id="pwdReq8" style="font-size:12px;color:var(--kb-text-secondary);margin-bottom:4px;display:flex;align-items:center;gap:6px">
          <span style="width:16px;text-align:center">○</span> 至少8位字符
        </div>
        <div id="pwdReqCase" style="font-size:12px;color:var(--kb-text-secondary);margin-bottom:4px;display:flex;align-items:center;gap:6px">
          <span style="width:16px;text-align:center">○</span> 包含大写和小写字母
        </div>
        <div id="pwdReqNum" style="font-size:12px;color:var(--kb-text-secondary);margin-bottom:4px;display:flex;align-items:center;gap:6px">
          <span style="width:16px;text-align:center">○</span> 包含数字
        </div>
        <div id="pwdReqSpecial" style="font-size:12px;color:var(--kb-text-secondary);display:flex;align-items:center;gap:6px">
          <span style="width:16px;text-align:center">○</span> 包含特殊字符（可选，加分）
        </div>
      </div>
      <button class="btn btn-primary" id="btnRegSubmit" style="margin-top:4px">注册</button>
    `
  }

  function renderStep3() {
    return `
      <div style="text-align:center;padding:20px 0">
        <div style="width:80px;height:80px;border-radius:50%;background:var(--kb-success-light);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px;animation:scaleIn 0.3s ease-out">
          <span style="display:flex;align-items:center;justify-content:center;color:var(--kb-success)">${icon('check', 40)}</span>
        </div>
        <div style="font-size:20px;font-weight:700;color:var(--kb-text);margin-bottom:8px">注册成功！</div>
        <div style="font-size:14px;color:var(--kb-text-secondary);margin-bottom:32px">请完成实名认证以使用全部功能</div>
        <button class="btn btn-primary" id="btnGoVerify" style="margin-bottom:12px">去实名认证</button>
        <button class="btn btn-secondary" id="btnGoHome">先进入首页</button>
      </div>
    `
  }

  function updateStep() {
    hideRegError()
    let bodyHtml = renderStepIndicator(currentStep)
    if (currentStep === 1) bodyHtml += renderStep1()
    else if (currentStep === 2) bodyHtml += renderStep2()
    else bodyHtml += renderStep3()

    app.innerHTML = `
      <div class="page">
        <div class="kb-page-header" style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff">${currentStep < 3 ? '<button class="kb-back-btn" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)" onclick="history.back()">' + icon('back', 18) + '</button>' : '<div style="width:32px"></div>'}<h1 style="font-size:17px;font-weight:600;margin:0">注册科佰支付</h1><div style="width:32px"></div></div>
        <div class="card" style="animation:slideUp 0.3s ease-out">
          ${bodyHtml}
        </div>
        ${currentStep < 3 ? `
          <div style="text-align:center;padding:16px 0">
            <button class="btn btn-text" id="btnGoLogin" style="font-size:13px;min-height:auto;padding:8px">已有账号？去登录</button>
          </div>
        ` : ''}
      </div>
    `

    if (currentStep === 1) {
      document.getElementById('btnGoLogin')?.addEventListener('click', () => navigate('login'))
      document.getElementById('regPhone')?.addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '')
        e.target.value = v
        const hint = document.getElementById('phoneHint')
        if (v.length === 0) { hint.textContent = ''; return }
        if (v.length === 11 && /^1[3-9]\d{9}$/.test(v)) {
          hint.innerHTML = '<span style="color:var(--kb-success);display:inline-flex;align-items:center;gap:4px">' + icon('check', 14) + ' 手机号格式正确</span>'
        } else if (v.length === 11) {
          hint.innerHTML = '<span style="color:var(--kb-error)">✗ 手机号格式不正确</span>'
        } else {
          hint.innerHTML = `<span style="color:var(--kb-text-secondary)">${v.length}/11</span>`
        }
      })
      document.getElementById('btnRegNext').onclick = () => {
        const nickname = document.getElementById('regNickname')?.value.trim() || ''
        const phone = document.getElementById('regPhone')?.value.trim() || ''
        const email = document.getElementById('regEmail')?.value.trim() || ''
        if (!nickname) { showRegError('请输入昵称'); return }
        if (!phone && !email) { showRegError('请至少提供手机号或邮箱'); return }
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) { showRegError('手机号格式不正确'); return }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showRegError('邮箱格式不正确'); return }
        window._regData = { nickname, phone, email }
        currentStep = 2
        updateStep()
      }
    }

    if (currentStep === 2) {
      document.getElementById('toggleRegPassword')?.addEventListener('click', () => {
        const input = document.getElementById('regPassword')
        const icon = document.getElementById('toggleRegPassword')
        if (input.type === 'password') { input.type = 'text'; icon.innerHTML = window.icon('eyeOff', 18) }
        else { input.type = 'password'; icon.innerHTML = window.icon('eye', 18) }
      })
      document.getElementById('regPassword')?.addEventListener('input', (e) => {
        const pwd = e.target.value
        const strength = document.getElementById('passwordStrength')
        if (pwd) {
          strength.innerHTML = renderPasswordStrength(pwd)
        } else {
          strength.innerHTML = ''
        }
        const req8 = document.getElementById('pwdReq8')
        const reqCase = document.getElementById('pwdReqCase')
        const reqNum = document.getElementById('pwdReqNum')
        const reqSpecial = document.getElementById('pwdReqSpecial')
        if (pwd.length >= 8) { req8.style.color = 'var(--kb-success)'; req8.querySelector('span').innerHTML = icon('check', 12) }
        else { req8.style.color = 'var(--kb-text-secondary)'; req8.querySelector('span').textContent = '○' }
        if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) { reqCase.style.color = 'var(--kb-success)'; reqCase.querySelector('span').innerHTML = icon('check', 12) }
        else { reqCase.style.color = 'var(--kb-text-secondary)'; reqCase.querySelector('span').textContent = '○' }
        if (/[0-9]/.test(pwd)) { reqNum.style.color = 'var(--kb-success)'; reqNum.querySelector('span').innerHTML = icon('check', 12) }
        else { reqNum.style.color = 'var(--kb-text-secondary)'; reqNum.querySelector('span').textContent = '○' }
        if (/[^A-Za-z0-9]/.test(pwd)) { reqSpecial.style.color = 'var(--kb-success)'; reqSpecial.querySelector('span').innerHTML = icon('check', 12) }
        else { reqSpecial.style.color = 'var(--kb-text-secondary)'; reqSpecial.querySelector('span').textContent = '○' }
      })
      document.getElementById('btnRegSubmit').onclick = async () => {
        const password = document.getElementById('regPassword')?.value || ''
        if (!password) { showRegError('请输入密码'); return }
        if (password.length < 8) { showRegError('密码至少8位'); return }
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { showRegError('密码需包含字母和数字'); return }

        const btn = document.getElementById('btnRegSubmit')
        btn.disabled = true
        btn.innerHTML = '<span class="animate-pulse" style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span>'

        const body = { ...window._regData, password }
        try {
          const res = await api('/auth/register', { method: 'POST', body: JSON.stringify(body) })
          token = res.token
          localStorage.setItem('kebaipay_token', token)
          currentStep = 3
          updateStep()
          document.getElementById('btnGoVerify')?.addEventListener('click', () => navigate('identity'))
          document.getElementById('btnGoHome')?.addEventListener('click', () => navigate('home'))
        } catch (e) {
          showRegError(e.message)
          btn.disabled = false
          btn.textContent = '注册'
        }
      }
    }
  }

  updateStep()
}

// 实名认证
function renderIdentity() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-identity-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 80px;color:#fff;position:relative;overflow:hidden}
        .kb-identity-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,255,255,0.12) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-identity-hero::after{content:'';position:absolute;bottom:-60px;left:-30px;width:160px;height:160px;background:radial-gradient(circle,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-identity-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-identity-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-identity-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-identity-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-identity-header .kb-placeholder{width:32px}
        .kb-identity-status-card{display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.15);border-radius:14px;position:relative;z-index:1;backdrop-filter:blur(4px)}
        .kb-identity-status-icon{width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .kb-identity-status-text .kb-label{font-size:12px;opacity:0.8;margin-bottom:2px}
        .kb-identity-status-text .kb-status{font-size:15px;font-weight:600}
        .kb-identity-content{margin:-56px 16px 0;position:relative;z-index:2}
        .kb-identity-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(15,23,42,0.07)}
        .kb-identity-notice{font-size:13px;color:var(--kb-text-secondary);line-height:1.6;padding:12px 14px;background:#f6ffed;border:1px solid #b7eb8f;border-radius:10px;margin-bottom:20px;display:flex;gap:8px}
        .kb-identity-notice svg{flex-shrink:0;margin-top:1px}
      </style>

      <div class="kb-identity-hero">
        <div class="kb-identity-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">实名认证</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-identity-status-card">
          <div class="kb-identity-status-icon">${icon('idCard', 22)}</div>
          <div class="kb-identity-status-text">
            <div class="kb-label">当前实名状态</div>
            <div class="kb-status" id="identityStatusText">加载中...</div>
          </div>
        </div>
      </div>

      <div class="kb-identity-content">
        <div class="kb-identity-card">
          <div class="kb-identity-notice">
            ${icon('check', 16, '#52c41a')}
            <span>金融级实名认证，认证后开通转账、收款、提现功能。本次同时设置6位支付密码，提交后将进入人工审核。</span>
          </div>

          <div class="form-group">
            <label class="form-label">真实姓名</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('user', 18)}</span>
              <input class="form-input" id="realName" placeholder="请输入真实姓名" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">身份证号</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('idCard', 18)}</span>
              <input class="form-input" id="idCard" placeholder="请输入18位身份证号" maxlength="18" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">支付密码</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
              <input class="form-input" id="payPassword" type="password" placeholder="请设置6位数字支付密码" maxlength="6" style="padding-left:42px;padding-right:46px;letter-spacing:4px">
              <button type="button" id="togglePayPwd" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eyeOff', 18)}</button>
            </div>
          </div>

          <button class="btn btn-primary" id="btnVerify" style="height:50px;font-size:16px;font-weight:600">提交认证</button>
        </div>
      </div>
    </div>
  `

  ;(async () => {
    try {
      const user = await api('/users/me')
      const statusMap = { UNVERIFIED: '未认证', PENDING: '审核中', VERIFIED: '已认证', REJECTED: '已拒绝' }
      const status = statusMap[user.realNameStatus] || user.realNameStatus || '未认证'
      document.getElementById('identityStatusText').textContent = status
      if (user.realNameStatus === 'VERIFIED') {
        document.getElementById('realName').value = user.realName || ''
        document.getElementById('idCard').value = user.idCard || ''
        document.getElementById('realName').disabled = true
        document.getElementById('idCard').disabled = true
        document.getElementById('payPassword').disabled = true
        const btn = document.getElementById('btnVerify')
        btn.disabled = true
        btn.textContent = '已完成实名认证'
      }
      if (user.realNameStatus === 'PENDING') {
        document.getElementById('btnVerify').disabled = true
        document.getElementById('btnVerify').textContent = '审核中，请耐心等待'
      }
    } catch (e) {
      document.getElementById('identityStatusText').textContent = '未认证'
    }
  })()

  document.getElementById('togglePayPwd').onclick = () => {
    const input = document.getElementById('payPassword')
    const btn = document.getElementById('togglePayPwd')
    if (input.type === 'password') { input.type = 'text'; btn.innerHTML = icon('eye', 18) }
    else { input.type = 'password'; btn.innerHTML = icon('eyeOff', 18) }
  }

  document.getElementById('btnVerify').onclick = async () => {
    const realName = document.getElementById('realName').value.trim()
    const idCard = document.getElementById('idCard').value.trim()
    const payPassword = document.getElementById('payPassword').value
    if (!realName) { showToast('请输入真实姓名'); return }
    if (!idCard || idCard.length < 15) { showToast('请输入正确的身份证号'); return }
    if (!payPassword || payPassword.length !== 6) { showToast('请设置6位数字支付密码'); return }
    const btn = document.getElementById('btnVerify')
    btn.disabled = true
    btn.textContent = '提交中...'
    try {
      await api('/users/verify-identity', { method: 'POST', body: JSON.stringify({ realName, idCard, payPassword }) })
      showToast('已提交，等待审核', 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
      btn.disabled = false
      btn.textContent = '提交认证'
    }
  }
}

// 首页
async function renderHome() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 80px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 12px) 20px 60px;color:#fff;position:relative;overflow:hidden}
        .kb-hero::before{content:'';position:absolute;top:-80px;right:-60px;width:220px;height:220px;background:radial-gradient(circle,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-hero::after{content:'';position:absolute;bottom:-40px;left:-30px;width:140px;height:140px;background:radial-gradient(circle,rgba(255,255,255,0.07) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-hero-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;position:relative;z-index:1}
        .kb-app-name{font-size:20px;font-weight:700;letter-spacing:1px}
        .kb-app-name span{font-weight:400;opacity:0.8;font-size:13px;margin-left:6px;letter-spacing:0}
        .kb-header-actions{display:flex;align-items:center;gap:10px}
        .kb-header-btn{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;border:none;color:#fff}
        .kb-header-btn:active{background:rgba(255,255,255,0.25)}
        .kb-avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;cursor:pointer;border:none;color:#fff}
        .kb-balance-label{font-size:13px;opacity:0.75;margin-bottom:6px;letter-spacing:0.5px;position:relative;z-index:1}
        .kb-balance-amount{font-size:40px;font-weight:700;letter-spacing:-0.5px;font-variant-numeric:tabular-nums;line-height:1.1;margin-bottom:16px;position:relative;z-index:1}
        .kb-balance-sub{display:flex;gap:32px;font-size:13px;position:relative;z-index:1}
        .kb-balance-sub span{display:flex;flex-direction:column;gap:2px}
        .kb-balance-sub .kb-sub-label{opacity:0.65;font-size:11px}
        .kb-balance-sub .kb-sub-value{font-weight:600;font-size:15px}
        .kb-content{margin:-40px 16px 0;position:relative;z-index:2}
        .kb-quick-card{background:#fff;border-radius:16px;padding:20px 8px 14px;box-shadow:0 4px 20px rgba(15,23,42,0.07);margin-bottom:14px}
        .kb-quick-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
        .kb-quick-action{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0 4px;cursor:pointer;transition:transform 0.15s;border:none;background:none;width:100%}
        .kb-quick-action:active{transform:scale(0.94)}
        .kb-action-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--kb-primary-light);color:var(--kb-primary)}
        .kb-action-icon svg{width:22px;height:22px}
        .kb-action-label{font-size:12px;color:var(--kb-text);font-weight:500}
        .kb-services-card{background:#fff;border-radius:16px;padding:18px 8px 14px;box-shadow:0 2px 12px rgba(15,23,42,0.04);margin-bottom:14px}
        .kb-services-title{font-size:13px;font-weight:600;color:var(--kb-text);padding:0 12px 12px}
        .kb-service-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
        .kb-service-item{display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 0;cursor:pointer;transition:transform 0.15s;border:none;background:none;width:100%}
        .kb-service-item:active{transform:scale(0.92)}
        .kb-service-icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center}
        .kb-service-icon svg{width:20px;height:20px}
        .kb-service-label{font-size:11px;color:var(--kb-text-secondary);font-weight:500}
        .kb-svc-red{background:#fef2f2;color:#ef4444}
        .kb-svc-blue{background:#eff6ff;color:#3b82f6}
        .kb-svc-green{background:#ecfdf5;color:#10b981}
        .kb-svc-purple{background:#f5f3ff;color:#8b5cf6}
        .kb-svc-orange{background:#fff7ed;color:#f97316}
        .kb-svc-teal{background:#f0fdfa;color:#14b8a6}
        .kb-svc-pink{background:#fdf2f8;color:#ec4899}
        .kb-svc-gray{background:#f3f4f6;color:#6b7280}
        .kb-section-card{background:#fff;border-radius:16px;padding:18px 16px;box-shadow:0 2px 12px rgba(15,23,42,0.04)}
        .kb-section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
        .kb-section-title{font-size:15px;font-weight:600;color:var(--kb-text)}
        .kb-section-more{font-size:12px;color:var(--kb-text-tertiary);cursor:pointer}
        .kb-txn-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--kb-border-light);cursor:pointer}
        .kb-txn-item:last-child{border-bottom:none}
        .kb-txn-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--kb-bg-elevated);color:var(--kb-text-secondary);flex-shrink:0}
        .kb-txn-icon svg{width:18px;height:18px}
        .kb-txn-icon.income{background:#ecfdf5;color:var(--kb-success)}
        .kb-txn-icon.expense{background:#fef2f2;color:var(--kb-error)}
        .kb-txn-icon.transfer{background:#eef2ff;color:var(--kb-primary)}
        .kb-txn-info{flex:1;min-width:0}
        .kb-txn-title{font-size:14px;color:var(--kb-text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .kb-txn-desc{font-size:11px;color:var(--kb-text-tertiary);margin-top:3px}
        .kb-txn-amount{font-size:15px;font-weight:600;text-align:right;white-space:nowrap}
        .kb-txn-amount.income{color:var(--kb-success)}
        .kb-txn-amount.expense{color:var(--kb-text)}
        .kb-bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;border-top:1px solid var(--kb-border-light);padding:8px 0 calc(8px + env(safe-area-inset-bottom));z-index:100}
        .kb-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0;cursor:pointer;color:var(--kb-text-tertiary);transition:color 0.2s;border:none;background:none}
        .kb-nav-item.active{color:var(--kb-primary)}
        .kb-nav-item svg{width:22px;height:22px}
        .kb-nav-label{font-size:10px;font-weight:500}
        .kb-empty-txn{text-align:center;padding:28px 0;color:var(--kb-text-tertiary);font-size:13px}
        .kb-empty-txn .kb-empty-icon{margin-bottom:8px;opacity:0.3}
        .kb-empty-txn .kb-empty-icon svg{width:44px;height:44px}
      </style>

      <div class="kb-hero">
        <div class="kb-hero-top">
          <div class="kb-app-name">科佰支付<span>KEBAIPAY</span></div>
          <div class="kb-header-actions">
            <button class="kb-header-btn" id="btnNotify" title="通知">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </button>
            <button class="kb-avatar" id="btnAvatar">U</button>
          </div>
        </div>
        <div class="kb-balance-label">总资产（元）</div>
        <div class="kb-balance-amount" id="totalBalance">--</div>
        <div class="kb-balance-sub">
          <span><span class="kb-sub-label">可用余额</span><span class="kb-sub-value" id="availableBalance">--</span></span>
          <span><span class="kb-sub-label">冻结金额</span><span class="kb-sub-value" id="frozenBalance">--</span></span>
        </div>
      </div>

      <div class="kb-content">
        <div class="kb-quick-card">
          <div class="kb-quick-actions">
            <button class="kb-quick-action" data-go="transfer">
              <div class="kb-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16l-4-4m0 0l4-4m-4 4h18"/><path d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
              </div>
              <div class="kb-action-label">转账</div>
            </button>
            <button class="kb-quick-action" data-go="qrcode">
              <div class="kb-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </div>
              <div class="kb-action-label">收款</div>
            </button>
            <button class="kb-quick-action" data-go="recharge">
              <div class="kb-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <div class="kb-action-label">充值</div>
            </button>
            <button class="kb-quick-action" data-go="withdraw">
              <div class="kb-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </div>
              <div class="kb-action-label">提现</div>
            </button>
          </div>
        </div>

        <div class="kb-services-card">
          <div class="kb-services-title">常用服务</div>
          <div class="kb-service-grid">
            <button class="kb-service-item" data-go="redpacket">
              <div class="kb-service-icon kb-svc-red">${icon('redpacket', 20)}</div>
              <div class="kb-service-label">红包</div>
            </button>
            <button class="kb-service-item" data-go="bankCards">
              <div class="kb-service-icon kb-svc-blue">${icon('card', 20)}</div>
              <div class="kb-service-label">银行卡</div>
            </button>
            <button class="kb-service-item" data-go="verify">
              <div class="kb-service-icon kb-svc-green">${icon('idCard', 20)}</div>
              <div class="kb-service-label">实名认证</div>
            </button>
            <button class="kb-service-item" data-go="bills">
              <div class="kb-service-icon kb-svc-purple">${icon('bill', 20)}</div>
              <div class="kb-service-label">账单</div>
            </button>
            <button class="kb-service-item" data-go="scan">
              <div class="kb-service-icon kb-svc-teal">${icon('scan', 20)}</div>
              <div class="kb-service-label">扫一扫</div>
            </button>
            <button class="kb-service-item" data-go="cashier">
              <div class="kb-service-icon kb-svc-orange">${icon('payment', 20)}</div>
              <div class="kb-service-label">付款码</div>
            </button>
            <button class="kb-service-item" data-go="security">
              <div class="kb-service-icon kb-svc-pink">${icon('lock', 20)}</div>
              <div class="kb-service-label">安全中心</div>
            </button>
            <button class="kb-service-item" data-go="help">
              <div class="kb-service-icon kb-svc-gray">${icon('help', 20)}</div>
              <div class="kb-service-label">帮助中心</div>
            </button>
          </div>
        </div>

        <div class="kb-section-card">
          <div class="kb-section-header">
            <div class="kb-section-title">最近交易</div>
            <div class="kb-section-more" data-go="bills">查看全部</div>
          </div>
          <div id="recentBills"></div>
        </div>
      </div>

      <div class="kb-bottom-nav">
        <button class="kb-nav-item active" data-nav="home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <div class="kb-nav-label">首页</div>
        </button>
        <button class="kb-nav-item" data-nav="wallet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
          <div class="kb-nav-label">钱包</div>
        </button>
        <button class="kb-nav-item" data-nav="bills">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div class="kb-nav-label">账单</div>
        </button>
        <button class="kb-nav-item" data-nav="profile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <div class="kb-nav-label">我的</div>
        </button>
      </div>
    </div>
  `

  document.getElementById('btnAvatar').onclick = () => navigate('profile')
  document.getElementById('btnNotify').onclick = () => { showModal('通知', '<div style="text-align:center;padding:16px;color:var(--kb-text-secondary)">暂无新通知</div>') }

  document.querySelectorAll('[data-go]').forEach((el) => {
    el.onclick = () => navigate(el.getAttribute('data-go'))
  })
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.onclick = () => navigate(el.getAttribute('data-nav'))
  })

  try {
    const [userRes, accountRes, billsRes] = await Promise.all([
      api('/users/me'),
      api('/accounts/me'),
      api('/bills'),
    ])
    currentUser = userRes
    currentAccount = accountRes
    document.getElementById('totalBalance').textContent = fmtMoney(accountRes.totalBalanceYuan)
    document.getElementById('availableBalance').textContent = fmtMoney(accountRes.availableBalanceYuan)
    document.getElementById('frozenBalance').textContent = fmtMoney(accountRes.frozenBalanceYuan)
    document.getElementById('btnAvatar').textContent = (userRes.nickname || 'U').charAt(0).toUpperCase()

    const container = document.getElementById('recentBills')
    const recent = billsRes.slice(0, 5)
    if (recent.length === 0) {
      container.innerHTML = `<div class="kb-empty-txn"><div class="kb-empty-icon">${icon('empty', 44)}</div>暂无交易记录</div>`
    } else {
      const billIconMap = { RECHARGE: 'recharge', WITHDRAW: 'withdraw', TRANSFER: 'transfer', RECEIPT: 'receipt', PAYMENT: 'payment', REFUND: 'refund', RED_PACKET: 'redpacket' }
      container.innerHTML = recent.map((b) => {
        const iconCls = b.direction === 'INCOME' ? (b.type === 'TRANSFER' || b.type === 'RECEIPT' ? 'transfer' : 'income') : 'expense'
        return `
        <div class="kb-txn-item" data-bill-id="${b.id}" style="cursor:pointer">
          <div class="kb-txn-icon ${iconCls}">${icon(billIconMap[b.type] || 'payment', 18)}</div>
          <div class="kb-txn-info">
            <div class="kb-txn-title">${fmtType(b.type)}${b.counterparty ? ' · ' + escapeHtml(b.counterparty) : ''}</div>
            <div class="kb-txn-desc">${fmtTime(b.createdAt)}${b.remark ? ' · ' + escapeHtml(b.remark) : ''}</div>
          </div>
          <div class="kb-txn-amount ${b.direction === 'INCOME' ? 'income' : 'expense'}">${b.direction === 'INCOME' ? '+' : '-'}${b.amountYuan}</div>
        </div>
      `}).join('')
      container.querySelectorAll('[data-bill-id]').forEach((el) => {
        el.onclick = () => navigate('billDetail?id=' + el.getAttribute('data-bill-id'))
      })
    }
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
}

function renderBillItem(b) {
  return `
    <div class="bill-item">
      <div class="bill-info">
        <div class="bill-type">${fmtType(b.type)} ${b.counterparty ? `(${escapeHtml(b.counterparty)})` : ''}</div>
        <div class="bill-time">${fmtTime(b.createdAt)} · ${escapeHtml(b.remark) || ''}</div>
      </div>
      <div class="bill-amount ${b.direction === 'INCOME' ? 'income' : 'expense'}">
        ${b.direction === 'INCOME' ? '+' : '-'}${b.amountYuan}
      </div>
    </div>
  `
}

// 转账
async function renderTransfer() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-transfer-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 56px;color:#fff;position:relative;overflow:hidden}
        .kb-transfer-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-transfer-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-transfer-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-transfer-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-transfer-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-transfer-header .kb-placeholder{width:32px}
        .kb-transfer-balance{position:relative;z-index:1}
        .kb-transfer-balance .kb-label{font-size:13px;opacity:0.75;margin-bottom:6px}
        .kb-transfer-balance .kb-amount{font-size:32px;font-weight:700;letter-spacing:-0.5px;margin-bottom:8px;font-variant-numeric:tabular-nums;line-height:1.1}
        .kb-transfer-content{margin:-36px 16px 0;position:relative;z-index:2}
        .kb-transfer-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(15,23,42,0.07)}
      </style>

      <div class="kb-transfer-hero">
        <div class="kb-transfer-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">转账</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-transfer-balance">
          <div class="kb-label">可用余额（元）</div>
          <div class="kb-amount" id="availableBalance">--</div>
        </div>
      </div>

      <div class="kb-transfer-content">
        <div class="kb-transfer-card">
          <div class="form-group">
            <label class="form-label">收款人</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('user', 18)}</span>
              <input class="form-input" id="toUserId" placeholder="请输入对方用户ID" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">转账金额</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:20px;font-weight:600;color:var(--kb-text-secondary)">¥</span>
              <input class="form-input" id="amount" type="number" placeholder="0.00" step="0.01" min="0.01" style="padding-left:36px;font-size:24px;font-weight:700;text-align:center">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">备注</label>
            <div style="position:relative">
              <input class="form-input" id="remark" placeholder="转账备注（选填）" maxlength="50">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">支付密码</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
              <input class="form-input" id="payPassword" type="password" placeholder="请输入6位支付密码" maxlength="6" style="padding-left:42px;padding-right:46px;font-size:16px;letter-spacing:4px">
              <button type="button" id="togglePayPwd" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eyeOff', 18)}</button>
            </div>
          </div>

          <button class="btn btn-primary" id="btnTransfer" style="height:50px;font-size:16px;font-weight:600">确认转账</button>
        </div>
      </div>
    </div>
  `

  try {
    const account = await api('/accounts/me')
    document.getElementById('availableBalance').textContent = fmtMoney(account.availableBalanceYuan)
  } catch (e) { /* ignore */ }

  document.getElementById('togglePayPwd').onclick = () => {
    const input = document.getElementById('payPassword')
    const btn = document.getElementById('togglePayPwd')
    if (input.type === 'password') { input.type = 'text'; btn.innerHTML = icon('eye', 18) }
    else { input.type = 'password'; btn.innerHTML = icon('eyeOff', 18) }
  }

  document.getElementById('btnTransfer').onclick = async () => {
    const toUserId = document.getElementById('toUserId').value.trim()
    const amount = Number(document.getElementById('amount').value)
    const remark = document.getElementById('remark').value
    const payPassword = document.getElementById('payPassword').value
    if (!toUserId) { showToast('请输入收款人ID'); return }
    if (!amount || amount <= 0) { showToast('请输入正确的转账金额'); return }
    if (!payPassword) { showToast('请输入支付密码'); return }
    const btn = document.getElementById('btnTransfer')
    btn.disabled = true
    btn.textContent = '转账中...'
    try {
      await api('/transfers', { method: 'POST', body: JSON.stringify({ toUserId, amount, remark, payPassword }) })
      showToast('转账成功', 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
      btn.disabled = false
      btn.textContent = '确认转账'
    }
  }
}

// 充值
async function renderRecharge() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-recharge-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 56px;color:#fff;position:relative;overflow:hidden}
        .kb-recharge-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-recharge-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-recharge-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-recharge-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-recharge-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-recharge-header .kb-placeholder{width:32px}
        .kb-recharge-balance{position:relative;z-index:1}
        .kb-recharge-balance .kb-label{font-size:13px;opacity:0.75;margin-bottom:6px}
        .kb-recharge-balance .kb-amount{font-size:32px;font-weight:700;letter-spacing:-0.5px;margin-bottom:8px;font-variant-numeric:tabular-nums;line-height:1.1}
        .kb-recharge-content{margin:-36px 16px 0;position:relative;z-index:2}
        .kb-recharge-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(15,23,42,0.07)}
        .kb-recharge-notice{background:var(--kb-primary-light);border:1px solid var(--kb-primary-muted);color:var(--kb-primary-dark);padding:10px 14px;border-radius:var(--kb-radius-md);font-size:13px;margin-bottom:20px;display:flex;align-items:flex-start;gap:8px;line-height:1.5}
        .kb-recharge-notice-icon{flex-shrink:0;margin-top:1px}
        .kb-recharge-notice-icon svg{width:16px;height:16px}
        .kb-amount-display{text-align:center;padding:16px 0 20px;margin-bottom:8px;border-bottom:1px solid var(--kb-border-light)}
        .kb-amount-symbol{font-size:24px;font-weight:600;color:var(--kb-text-secondary);margin-right:4px;vertical-align:top}
        .kb-amount-input{font-size:36px;font-weight:700;color:var(--kb-text);border:none;outline:none;background:transparent;text-align:center;width:200px;font-variant-numeric:tabular-nums}
        .kb-quick-amounts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px}
        .kb-quick-amount{padding:10px 0;border-radius:10px;border:1.5px solid var(--kb-border-light);background:var(--kb-bg);font-size:14px;font-weight:500;color:var(--kb-text);cursor:pointer;transition:all 0.2s;text-align:center}
        .kb-quick-amount:active,.kb-quick-amount.active{border-color:var(--kb-primary);background:var(--kb-primary-light);color:var(--kb-primary)}
      </style>

      <div class="kb-recharge-hero">
        <div class="kb-recharge-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">余额充值</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-recharge-balance">
          <div class="kb-label">当前可用余额（元）</div>
          <div class="kb-amount" id="currentBalance">--</div>
        </div>
      </div>

      <div class="kb-recharge-content">
        <div class="kb-recharge-card">
          <div class="kb-recharge-notice">
            <span class="kb-recharge-notice-icon">${icon('help', 16)}</span>
            <span>MVP 为模拟充值，输入金额并验证支付密码后余额直接到账。</span>
          </div>

          <div class="form-group">
            <label class="form-label">充值金额</label>
            <div class="kb-amount-display">
              <span class="kb-amount-symbol">¥</span>
              <input class="kb-amount-input" id="amount" type="number" placeholder="0.00" step="0.01" min="0.01">
            </div>
          </div>

          <div class="kb-quick-amounts">
            <button class="kb-quick-amount" data-amount="50">50</button>
            <button class="kb-quick-amount" data-amount="100">100</button>
            <button class="kb-quick-amount" data-amount="200">200</button>
            <button class="kb-quick-amount" data-amount="500">500</button>
          </div>

          <div class="form-group">
            <label class="form-label">支付密码</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
              <input class="form-input" id="payPassword" type="password" placeholder="请输入6位支付密码" maxlength="6" style="padding-left:42px;padding-right:46px;font-size:16px;letter-spacing:4px">
              <button type="button" id="togglePayPwd" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eyeOff', 18)}</button>
            </div>
          </div>

          <button class="btn btn-primary" id="btnRecharge" style="height:50px;font-size:16px;font-weight:600;margin-top:4px">
            <span id="rechargeBtnText">立即充值</span>
            <span id="rechargeBtnLoading" style="display:none"><span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span></span>
          </button>
        </div>
      </div>
    </div>
  `

  try {
    const account = await api('/accounts/me')
    document.getElementById('currentBalance').textContent = fmtMoney(account.availableBalanceYuan)
  } catch (e) { /* ignore */ }

  document.querySelectorAll('.kb-quick-amount').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.kb-quick-amount').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById('amount').value = btn.getAttribute('data-amount')
    }
  })

  document.getElementById('togglePayPwd').onclick = () => {
    const input = document.getElementById('payPassword')
    const btn = document.getElementById('togglePayPwd')
    if (input.type === 'password') { input.type = 'text'; btn.innerHTML = icon('eye', 18) }
    else { input.type = 'password'; btn.innerHTML = icon('eyeOff', 18) }
  }

  const setLoading = (loading) => {
    const btn = document.getElementById('btnRecharge')
    btn.disabled = loading
    document.getElementById('rechargeBtnText').style.display = loading ? 'none' : 'inline'
    document.getElementById('rechargeBtnLoading').style.display = loading ? 'inline' : 'none'
  }

  document.getElementById('btnRecharge').onclick = async () => {
    const amount = Number(document.getElementById('amount').value)
    const payPassword = document.getElementById('payPassword').value
    if (!amount || amount <= 0) { showToast('请输入正确的充值金额'); return }
    if (!payPassword) { showToast('请输入支付密码'); return }
    setLoading(true)
    try {
      await api('/transactions/recharge', { method: 'POST', body: JSON.stringify({ amount, payPassword }) })
      showToast('充值成功', 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
      setLoading(false)
    }
  }
}

// 账单
async function renderBills() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 80px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-bills-header{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 20px 12px;background:#fff}
        .kb-bills-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text);font-size:0}
        .kb-bills-header .kb-back:active{background:var(--kb-border-light)}
        .kb-bills-header .kb-title{font-size:17px;font-weight:600;color:var(--kb-text);letter-spacing:0.5px}
        .kb-bills-header .kb-action{font-size:12px;color:var(--kb-primary);cursor:pointer;padding:6px 12px;border-radius:20px;background:var(--kb-primary-light);font-weight:500;border:none}
        .kb-bills-tabs{display:flex;background:#fff;padding:0 16px 8px}
        .kb-bills-tab{flex:1;text-align:center;padding:10px 0 12px;font-size:14px;color:var(--kb-text-tertiary);cursor:pointer;position:relative;transition:color 0.2s;font-weight:500}
        .kb-bills-tab.active{color:var(--kb-primary);font-weight:600}
        .kb-bills-tab.active::after{content:'';position:absolute;bottom:0;left:30%;right:30%;height:2.5px;background:var(--kb-primary);border-radius:3px}
        .kb-filter-bar{display:flex;gap:8px;padding:12px 16px;overflow-x:auto;background:#fff}
        .kb-filter-bar::-webkit-scrollbar{display:none}
        .kb-filter-chip{padding:7px 14px;border-radius:20px;font-size:13px;border:1px solid var(--kb-border-light);color:var(--kb-text-secondary);white-space:nowrap;cursor:pointer;transition:all 0.2s;background:#fff;font-weight:500}
        .kb-filter-chip.active{background:var(--kb-primary);color:#fff;border-color:var(--kb-primary);box-shadow:0 2px 8px rgba(30,58,138,0.2)}
        .kb-search-bar{padding:0 16px 12px;background:#fff}
        .kb-search-input{width:100%;padding:10px 14px 10px 38px;border:1px solid var(--kb-border-light);border-radius:12px;font-size:14px;background:var(--kb-bg);outline:none;transition:all 0.2s;color:var(--kb-text)}
        .kb-search-input:focus{border-color:var(--kb-primary);box-shadow:0 0 0 3px var(--kb-primary-light)}
        .kb-search-wrap{position:relative}
        .kb-search-wrap .kb-search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);display:flex;align-items:center}
        .kb-search-wrap .kb-search-icon svg{width:16px;height:16px}
        .kb-type-filter{padding:0 16px 12px;background:#fff}
        .kb-type-select{width:100%;padding:10px 14px;border:1px solid var(--kb-border-light);border-radius:12px;font-size:14px;background:var(--kb-bg);color:var(--kb-text);outline:none}
        .kb-bill-list{padding:8px 16px 0}
        .kb-bill-card{background:#fff;border-radius:14px;margin-bottom:8px;padding:14px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:transform 0.15s;box-shadow:0 1px 3px rgba(15,23,42,0.04)}
        .kb-bill-card:active{transform:scale(0.98)}
        .kb-bill-icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .kb-bill-icon svg{width:20px;height:20px}
        .kb-bill-body{flex:1;min-width:0}
        .kb-bill-top{display:flex;justify-content:space-between;align-items:center}
        .kb-bill-type{font-size:14px;font-weight:500;color:var(--kb-text)}
        .kb-bill-amount{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
        .kb-bill-amount.income{color:#059669}
        .kb-bill-amount.expense{color:var(--kb-text)}
        .kb-bill-meta{font-size:12px;color:var(--kb-text-tertiary);margin-top:4px}
        .kb-skeleton{background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:kbShimmer 1.5s infinite;border-radius:8px}
        @keyframes kbShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .kb-skeleton-bill{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border-radius:14px;margin-bottom:8px}
        .kb-skeleton-icon{width:42px;height:42px;border-radius:12px;flex-shrink:0}
        .kb-skeleton-lines{flex:1}
        .kb-skeleton-line{height:14px;border-radius:4px;margin-bottom:8px}
        .kb-empty-state{text-align:center;padding:48px 16px}
        .kb-empty-state .kb-empty-icon{width:72px;height:72px;margin:0 auto 16px;border-radius:50%;background:var(--kb-bg-elevated);display:flex;align-items:center;justify-content:center;color:var(--kb-text-tertiary)}
        .kb-empty-state .kb-empty-icon svg{width:36px;height:36px}
        .kb-empty-state .kb-empty-text{font-size:15px;color:var(--kb-text-secondary);margin-bottom:4px;font-weight:500}
        .kb-empty-state .kb-empty-sub{font-size:13px;color:var(--kb-text-tertiary)}
        .kb-load-more{text-align:center;padding:16px;font-size:13px;color:var(--kb-text-tertiary);cursor:pointer}
        .kb-load-more:active{color:var(--kb-primary)}
        .kb-loading-spinner{display:inline-block;width:20px;height:20px;border:2px solid var(--kb-border-light);border-top-color:var(--kb-primary);border-radius:50%;animation:spin 0.6s linear infinite}
        .kb-bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;border-top:1px solid var(--kb-border-light);padding:8px 0 calc(8px + env(safe-area-inset-bottom));z-index:100}
        .kb-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0;cursor:pointer;color:var(--kb-text-tertiary);transition:color 0.2s;border:none;background:none}
        .kb-nav-item.active{color:var(--kb-primary)}
        .kb-nav-item svg{width:22px;height:22px}
        .kb-nav-item .kb-nav-label{font-size:10px;font-weight:500}
      </style>

      <div class="kb-bills-header">
        <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
        <div class="kb-title">账单</div>
        <button class="kb-action" id="btnExportCsv">导出CSV</button>
      </div>

      <div class="kb-bills-tabs" id="billsTabs">
        <div class="kb-bills-tab active" data-dir="">全部</div>
        <div class="kb-bills-tab" data-dir="INCOME">收入</div>
        <div class="kb-bills-tab" data-dir="EXPENSE">支出</div>
      </div>

      <div class="kb-filter-bar" id="dateFilter">
        <div class="kb-filter-chip active" data-range="today">今天</div>
        <div class="kb-filter-chip" data-range="week">本周</div>
        <div class="kb-filter-chip" data-range="month">本月</div>
        <div class="kb-filter-chip" data-range="custom">自定义</div>
      </div>

      <div id="customDateRange" style="display:none;padding:0 16px 12px;background:#fff">
        <div style="display:flex;gap:8px">
          <input type="date" id="dateStart" class="kb-search-input" style="flex:1;padding-left:14px">
          <input type="date" id="dateEnd" class="kb-search-input" style="flex:1;padding-left:14px">
        </div>
      </div>

      <div class="kb-type-filter">
        <select class="kb-type-select" id="typeFilter">
          <option value="">全部类型</option>
          <option value="RECHARGE">充值</option>
          <option value="WITHDRAW">提现</option>
          <option value="TRANSFER">转账</option>
          <option value="PAYMENT">消费</option>
          <option value="REFUND">退款</option>
          <option value="RED_PACKET">红包</option>
        </select>
      </div>

      <div class="kb-search-bar">
        <div class="kb-search-wrap">
          <span class="kb-search-icon">${icon('search', 16)}</span>
          <input class="kb-search-input" id="searchKeyword" placeholder="搜索对方、备注、金额...">
        </div>
      </div>

      <div class="kb-bill-list" id="billList"></div>

      <div class="kb-bottom-nav">
        <button class="kb-nav-item" data-nav="home">
          ${icon('home', 22)}
          <div class="kb-nav-label">首页</div>
        </button>
        <button class="kb-nav-item" data-nav="wallet">
          ${icon('wallet', 22)}
          <div class="kb-nav-label">钱包</div>
        </button>
        <button class="kb-nav-item active" data-nav="bills">
          ${icon('bill', 22)}
          <div class="kb-nav-label">账单</div>
        </button>
        <button class="kb-nav-item" data-nav="profile">
          ${icon('user', 22)}
          <div class="kb-nav-label">我的</div>
        </button>
      </div>
    </div>
  `

  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.onclick = () => navigate(el.getAttribute('data-nav'))
  })

  const typeIconMap = { RECHARGE: 'recharge', WITHDRAW: 'withdraw', TRANSFER: 'transfer', RECEIPT: 'receipt', PAYMENT: 'payment', REFUND: 'refund', RED_PACKET: 'redpacket' }
  const typeIconBg = { RECHARGE: '#ecfdf5', WITHDRAW: '#fef2f2', TRANSFER: '#eff6ff', RECEIPT: '#ecfdf5', PAYMENT: '#fffbeb', REFUND: '#faf5ff', RED_PACKET: '#fef2f2' }
  const typeIconColor = { RECHARGE: '#059669', WITHDRAW: '#dc2626', TRANSFER: '#1d4ed8', RECEIPT: '#059669', PAYMENT: '#d97706', REFUND: '#7c3aed', RED_PACKET: '#dc2626' }

  let currentDir = ''
  let currentRange = 'today'
  let currentPage = 1
  let currentType = ''
  let currentKeyword = ''
  let allBills = []
  let isLoading = false
  const PAGE_SIZE = 20

  function showSkeleton() {
    const container = document.getElementById('billList')
    let html = ''
    for (let i = 0; i < 5; i++) {
      html += `
        <div class="kb-skeleton-bill">
          <div class="kb-skeleton kb-skeleton-icon"></div>
          <div class="kb-skeleton-lines" style="flex:1">
            <div class="kb-skeleton kb-skeleton-line" style="width:60%"></div>
            <div class="kb-skeleton kb-skeleton-line" style="width:40%;height:10px"></div>
          </div>
          <div class="kb-skeleton" style="width:70px;height:18px"></div>
        </div>
      `
    }
    container.innerHTML = html
  }

  function getDateRange(range) {
    const now = new Date()
    const today = fmtDate(now)
    let startDate = '', endDate = today
    if (range === 'today') {
      startDate = today
    } else if (range === 'week') {
      const d = new Date(now)
      d.setDate(d.getDate() - d.getDay())
      startDate = fmtDate(d)
    } else if (range === 'month') {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    } else if (range === 'custom') {
      startDate = document.getElementById('dateStart')?.value || ''
      endDate = document.getElementById('dateEnd')?.value || today
    }
    return { startDate, endDate }
  }

  function filterBills(bills) {
    let filtered = [...bills]
    if (currentDir) {
      filtered = filtered.filter((b) => b.direction === currentDir)
    }
    if (currentType) {
      filtered = filtered.filter((b) => b.type === currentType)
    }
    if (currentKeyword) {
      const kw = currentKeyword.toLowerCase()
      filtered = filtered.filter((b) =>
        (b.counterparty && b.counterparty.toLowerCase().includes(kw)) ||
        (b.remark && b.remark.toLowerCase().includes(kw)) ||
        (b.amountYuan && String(b.amountYuan).includes(kw))
      )
    }
    const { startDate, endDate } = getDateRange(currentRange)
    if (startDate) {
      filtered = filtered.filter((b) => {
        const d = new Date(b.createdAt)
        const s = new Date(startDate + 'T00:00:00')
        return d >= s
      })
    }
    if (endDate) {
      filtered = filtered.filter((b) => {
        const d = new Date(b.createdAt)
        const e = new Date(endDate + 'T23:59:59')
        return d <= e
      })
    }
    return filtered
  }

  function renderBillList() {
    const container = document.getElementById('billList')
    const filtered = filterBills(allBills)
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    currentPage = Math.min(currentPage, totalPages)
    const start = (currentPage - 1) * PAGE_SIZE
    const pageData = filtered.slice(start, start + PAGE_SIZE)

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="kb-empty-state">
          <div class="kb-empty-icon">${icon('empty', 36)}</div>
          <div class="kb-empty-text">暂无账单记录</div>
          <div class="kb-empty-sub">试试调整筛选条件</div>
        </div>
      `
      return
    }

    container.innerHTML = pageData.map((b) => `
      <div class="kb-bill-card" data-bill-id="${b.id}">
        <div class="kb-bill-icon" style="background:${typeIconBg[b.type] || '#f1f5f9'};color:${typeIconColor[b.type] || '#64748b'}">${icon(typeIconMap[b.type] || 'empty', 20)}</div>
        <div class="kb-bill-body">
          <div class="kb-bill-top">
            <div class="kb-bill-type">${fmtType(b.type)}${b.counterparty ? ' · ' + escapeHtml(b.counterparty) : ''}</div>
            <div class="kb-bill-amount ${b.direction === 'INCOME' ? 'income' : 'expense'}">${b.direction === 'INCOME' ? '+' : '-'}${b.amountYuan}</div>
          </div>
          <div class="kb-bill-meta">${fmtTime(b.createdAt)}${b.remark ? ' · ' + escapeHtml(b.remark) : ''}</div>
        </div>
      </div>
    `).join('') + `
      <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:16px 0;font-size:13px;color:var(--kb-text-secondary)">
        <span>共 ${filtered.length} 条</span>
        ${totalPages > 1 ? `
          <button class="kb-filter-chip" onclick="window._billPagePrev()" ${currentPage <= 1 ? 'disabled style="opacity:0.4"' : ''}>‹ 上一页</button>
          <span>${currentPage}/${totalPages}</span>
          <button class="kb-filter-chip" onclick="window._billPageNext()" ${currentPage >= totalPages ? 'disabled style="opacity:0.4"' : ''}>下一页 ›</button>
        ` : ''}
      </div>
    `

    container.querySelectorAll('[data-bill-id]').forEach((el) => {
      el.onclick = () => navigate('billDetail?id=' + el.getAttribute('data-bill-id'))
    })
  }

  window._billPagePrev = () => { if (currentPage > 1) { currentPage--; renderBillList() } }
  window._billPageNext = () => { currentPage++; renderBillList() }

  async function loadBills() {
    showSkeleton()
    try {
      allBills = await api('/bills')
      renderBillList()
    } catch (e) {
      document.getElementById('billList').innerHTML = `<div class="kb-empty-state"><div class="kb-empty-icon">${icon('empty', 48)}</div><div class="kb-empty-text">加载失败：${e.message}</div></div>`
    }
  }

  document.querySelectorAll('#billsTabs .kb-bills-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('#billsTabs .kb-bills-tab').forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      currentDir = tab.getAttribute('data-dir')
      currentPage = 1
      renderBillList()
    }
  })

  document.querySelectorAll('#dateFilter .kb-filter-chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('#dateFilter .kb-filter-chip').forEach((c) => c.classList.remove('active'))
      chip.classList.add('active')
      currentRange = chip.getAttribute('data-range')
      currentPage = 1
      const customRange = document.getElementById('customDateRange')
      customRange.style.display = currentRange === 'custom' ? 'block' : 'none'
      renderBillList()
    }
  })

  document.getElementById('typeFilter').onchange = (e) => {
    currentType = e.target.value
    currentPage = 1
    renderBillList()
  }

  let searchTimer = null
  document.getElementById('searchKeyword').oninput = (e) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      currentKeyword = e.target.value.trim()
      currentPage = 1
      renderBillList()
    }, 300)
  }

  document.getElementById('btnExportCsv').onclick = () => {
    const filtered = filterBills(allBills)
    if (filtered.length === 0) return showToast('无数据可导出')
    const header = '类型,方向,金额,对方,备注,时间\n'
    const rows = filtered.map((b) => `${fmtType(b.type)},${b.direction === 'INCOME' ? '收入' : '支出'},${b.amountYuan},${b.counterparty || ''},${b.remark || ''},${b.createdAt}`).join('\n')
    const bom = '\uFEFF'
    const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bills_${fmtDate(new Date())}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  await loadBills()
}

// 钱包页
async function renderWallet() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 80px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-wallet-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 56px;color:#fff;position:relative;overflow:hidden}
        .kb-wallet-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-wallet-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;position:relative;z-index:1}
        .kb-wallet-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:0}
        .kb-wallet-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-wallet-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-wallet-header .kb-action{font-size:13px;color:rgba(255,255,255,0.85);cursor:pointer}
        .kb-wallet-balance{position:relative;z-index:1}
        .kb-wallet-balance .kb-label{font-size:13px;opacity:0.75;margin-bottom:6px;letter-spacing:0.5px}
        .kb-wallet-balance .kb-amount{font-size:36px;font-weight:700;letter-spacing:-0.5px;margin-bottom:14px;font-variant-numeric:tabular-nums;line-height:1.1}
        .kb-wallet-balance .kb-sub{display:flex;gap:28px;font-size:12px}
        .kb-wallet-balance .kb-sub span{display:flex;flex-direction:column;gap:2px}
        .kb-wallet-balance .kb-sub b{font-size:15px;font-weight:600;color:#fff}
        .kb-wallet-content{margin:-36px 16px 0;position:relative;z-index:2}
        .kb-wallet-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#fff;border-radius:16px;padding:16px 8px 12px;box-shadow:0 4px 20px rgba(15,23,42,0.07);margin-bottom:14px}
        .kb-wallet-action{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0 4px;cursor:pointer;transition:transform 0.15s;border:none;background:none}
        .kb-wallet-action:active{transform:scale(0.94)}
        .kb-wallet-action .kb-action-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--kb-primary-light);color:var(--kb-primary)}
        .kb-wallet-action .kb-action-icon svg{width:22px;height:22px}
        .kb-wallet-action .kb-action-label{font-size:12px;color:var(--kb-text);font-weight:500}
        .kb-wallet-section{background:#fff;border-radius:16px;margin-bottom:14px;padding:4px 16px;box-shadow:0 2px 12px rgba(15,23,42,0.04)}
        .kb-wallet-section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:0;padding:14px 0 10px;border-bottom:1px solid var(--kb-border-light)}
        .kb-wallet-section-title{font-size:15px;font-weight:600;color:var(--kb-text)}
        .kb-wallet-link{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--kb-border-light);cursor:pointer;background:none;border-left:none;border-right:none;border-top:none;width:100%}
        .kb-wallet-link:last-child{border-bottom:none}
        .kb-wallet-link-left{display:flex;align-items:center;gap:12px}
        .kb-wallet-link-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--kb-bg-elevated);color:var(--kb-text-secondary)}
        .kb-wallet-link-icon svg{width:18px;height:18px}
        .kb-wallet-link-text{font-size:14px;color:var(--kb-text)}
        .kb-wallet-link-arrow{color:var(--kb-text-tertiary);display:flex;align-items:center}
        .kb-wallet-link-arrow svg{width:16px;height:16px}
        .kb-bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;border-top:1px solid var(--kb-border-light);padding:8px 0 calc(8px + env(safe-area-inset-bottom));z-index:100}
        .kb-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0;cursor:pointer;color:var(--kb-text-tertiary);transition:color 0.2s;border:none;background:none}
        .kb-nav-item.active{color:var(--kb-primary)}
        .kb-nav-item svg{width:22px;height:22px}
        .kb-nav-item .kb-nav-label{font-size:10px;font-weight:500}
        .kb-txn-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--kb-border-light)}
        .kb-txn-item:last-child{border-bottom:none}
        .kb-txn-icon{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .kb-txn-icon svg{width:20px;height:20px}
        .kb-txn-info{flex:1;min-width:0}
        .kb-txn-title{font-size:14px;font-weight:500;color:var(--kb-text);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .kb-txn-desc{font-size:12px;color:var(--kb-text-tertiary)}
        .kb-txn-amount{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
        .kb-txn-amount.income{color:#059669}
        .kb-txn-amount.expense{color:var(--kb-text)}
      </style>

      <div class="kb-wallet-hero">
        <div class="kb-wallet-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">我的钱包</div>
          <div class="kb-action" data-go="security">设置</div>
        </div>

        <div class="kb-wallet-balance">
          <div class="kb-label">总资产（元）</div>
          <div class="kb-amount" id="totalBalance">--</div>
          <div class="kb-sub">
            <span><span style="opacity:0.7;font-size:11px">可用余额</span><b id="availableBalance">--</b></span>
            <span><span style="opacity:0.7;font-size:11px">冻结金额</span><b id="frozenBalance">--</b></span>
          </div>
        </div>
      </div>

      <div class="kb-wallet-content">
      <div class="kb-wallet-actions">
        <button class="kb-wallet-action" data-go="recharge">
          <div class="kb-action-icon">${icon('plus', 22)}</div>
          <div class="kb-action-label">充值</div>
        </button>
        <button class="kb-wallet-action" data-go="withdraw">
          <div class="kb-action-icon">${icon('minus', 22)}</div>
          <div class="kb-action-label">提现</div>
        </button>
        <button class="kb-wallet-action" data-go="transfer">
          <div class="kb-action-icon">${icon('transfer', 22)}</div>
          <div class="kb-action-label">转账</div>
        </button>
      </div>

      <div class="kb-wallet-section">
        <div class="kb-wallet-section-header">
          <div class="kb-wallet-section-title">最近交易</div>
          <div class="kb-section-more" data-go="bills" style="font-size:12px;color:var(--kb-text-tertiary);cursor:pointer">查看全部</div>
        </div>
        <div id="walletRecentBills"></div>
      </div>

      <div class="kb-wallet-section">
        <button class="kb-wallet-link" data-go="security">
          <div class="kb-wallet-link-left">
            <div class="kb-wallet-link-icon">${icon('lock', 18)}</div>
            <div class="kb-wallet-link-text">账户安全</div>
          </div>
          <div class="kb-wallet-link-arrow">${icon('chevronRight', 16)}</div>
        </button>
        <button class="kb-wallet-link" data-go="identity">
          <div class="kb-wallet-link-left">
            <div class="kb-wallet-link-icon">${icon('user', 18)}</div>
            <div class="kb-wallet-link-text">实名认证</div>
          </div>
          <div class="kb-wallet-link-arrow">${icon('chevronRight', 16)}</div>
        </button>
        <button class="kb-wallet-link" data-go="profile">
          <div class="kb-wallet-link-left">
            <div class="kb-wallet-link-icon">${icon('settings', 18)}</div>
            <div class="kb-wallet-link-text">个人资料</div>
          </div>
          <div class="kb-wallet-link-arrow">${icon('chevronRight', 16)}</div>
        </button>
      </div>
      </div>

      <div class="kb-bottom-nav">
        <button class="kb-nav-item" data-nav="home">
          ${icon('home', 22)}
          <div class="kb-nav-label">首页</div>
        </button>
        <button class="kb-nav-item active" data-nav="wallet">
          ${icon('wallet', 22)}
          <div class="kb-nav-label">钱包</div>
        </button>
        <button class="kb-nav-item" data-nav="bills">
          ${icon('bill', 22)}
          <div class="kb-nav-label">账单</div>
        </button>
        <button class="kb-nav-item" data-nav="profile">
          ${icon('user', 22)}
          <div class="kb-nav-label">我的</div>
        </button>
      </div>
    </div>
  `

  document.querySelectorAll('[data-go]').forEach((el) => {
    el.onclick = () => navigate(el.getAttribute('data-go'))
  })
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.onclick = () => navigate(el.getAttribute('data-nav'))
  })

  try {
    const [accountRes, billsRes] = await Promise.all([
      api('/accounts/me'),
      api('/bills'),
    ])
    currentAccount = accountRes
    document.getElementById('totalBalance').textContent = fmtMoney(accountRes.totalBalanceYuan)
    document.getElementById('availableBalance').textContent = fmtMoney(accountRes.availableBalanceYuan)
    document.getElementById('frozenBalance').textContent = fmtMoney(accountRes.frozenBalanceYuan)

    const container = document.getElementById('walletRecentBills')
    const recent = billsRes.slice(0, 5)
    const typeIconMap = { RECHARGE: 'recharge', WITHDRAW: 'withdraw', TRANSFER: 'transfer', RECEIPT: 'receipt', PAYMENT: 'payment', REFUND: 'refund', RED_PACKET: 'redpacket' }
    const typeIconBg = { RECHARGE: '#ecfdf5', WITHDRAW: '#fef2f2', TRANSFER: '#eff6ff', RECEIPT: '#ecfdf5', PAYMENT: '#fffbeb', REFUND: '#faf5ff', RED_PACKET: '#fef2f2' }
    const typeIconColor = { RECHARGE: '#059669', WITHDRAW: '#dc2626', TRANSFER: '#1d4ed8', RECEIPT: '#059669', PAYMENT: '#d97706', REFUND: '#7c3aed', RED_PACKET: '#dc2626' }
    if (recent.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--kb-text-tertiary);font-size:14px">暂无交易记录</div>'
    } else {
      container.innerHTML = recent.map((b) => `
        <div class="kb-txn-item" data-bill-id="${b.id}" style="cursor:pointer">
          <div class="kb-txn-icon" style="background:${typeIconBg[b.type] || '#f1f5f9'};color:${typeIconColor[b.type] || '#64748b'}">${icon(typeIconMap[b.type] || 'empty', 20)}</div>
          <div class="kb-txn-info">
            <div class="kb-txn-title">${fmtType(b.type)}${b.counterparty ? ' · ' + b.counterparty : ''}</div>
            <div class="kb-txn-desc">${fmtTime(b.createdAt)}${b.remark ? ' · ' + b.remark : ''}</div>
          </div>
          <div class="kb-txn-amount ${b.direction === 'INCOME' ? 'income' : 'expense'}">${b.direction === 'INCOME' ? '+' : '-'}${b.amountYuan}</div>
        </div>
      `).join('')
      container.querySelectorAll('[data-bill-id]').forEach((el) => {
        el.onclick = () => navigate('billDetail?id=' + el.getAttribute('data-bill-id'))
      })
    }
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
}

// 账单详情
async function renderBillDetail() {
  if (!token) return navigate('login')
  const params = getHashParamObj()
  const billId = params.id
  if (!billId) return navigate('bills')

  app.innerHTML = `
    <div class="page">
      <style>
        .kb-detail-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
        .kb-detail-header .kb-back{font-size:20px;cursor:pointer;color:var(--kb-text);width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .kb-detail-header .kb-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .kb-detail-header .kb-placeholder{width:32px}
        .kb-detail-hero{text-align:center;padding:32px 16px;background:#fff}
        .kb-detail-hero .kb-hero-icon{width:64px;height:64px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:12px}
        .kb-detail-hero .kb-hero-type{font-size:14px;color:var(--kb-text-secondary);margin-bottom:4px}
        .kb-detail-hero .kb-hero-amount{font-size:40px;font-weight:700;letter-spacing:1px}
        .kb-detail-hero .kb-hero-amount.income{color:var(--kb-success)}
        .kb-detail-hero .kb-hero-amount.expense{color:var(--kb-text)}
        .kb-detail-section{background:#fff;margin:12px 16px;border-radius:12px;overflow:hidden}
        .kb-detail-row{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--kb-border-light)}
        .kb-detail-row:last-child{border-bottom:none}
        .kb-detail-label{font-size:14px;color:var(--kb-text-secondary)}
        .kb-detail-value{font-size:14px;color:var(--kb-text);text-align:right;max-width:60%;word-break:break-all}
        .kb-status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
        .kb-related-card{background:#fff;margin:12px 16px;border-radius:12px;padding:16px}
        .kb-related-title{font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px}
        .kb-related-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--kb-border-light)}
        .kb-related-item:last-child{border-bottom:none}
        .kb-related-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
        .kb-related-info{flex:1}
        .kb-related-info .kb-related-type{font-size:13px;font-weight:500;color:var(--kb-text)}
        .kb-related-info .kb-related-meta{font-size:12px;color:var(--kb-text-tertiary);margin-top:2px}
        .kb-related-amount{font-size:14px;font-weight:600}
        .kb-related-amount.income{color:var(--kb-success)}
        .kb-related-amount.expense{color:var(--kb-text)}
      </style>

      <div class="kb-detail-header">
        <button class="kb-back" onclick="history.back()" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)">${icon('back', 18)}</button>
        <div class="kb-title">账单详情</div>
        <div class="kb-placeholder"></div>
      </div>

      <div id="billDetailContent">
        <div class="kb-detail-hero">
          <div class="kb-skeleton" style="width:64px;height:64px;border-radius:16px;margin:0 auto 12px"></div>
          <div class="kb-skeleton" style="width:80px;height:14px;margin:0 auto 8px"></div>
          <div class="kb-skeleton" style="width:160px;height:40px;margin:0 auto"></div>
        </div>
        <div class="kb-detail-section">
          <div class="kb-skeleton" style="height:48px;margin:0"></div>
          <div class="kb-skeleton" style="height:48px;margin:0"></div>
          <div class="kb-skeleton" style="height:48px;margin:0"></div>
        </div>
      </div>
    </div>
  `

  const typeIcons = { RECHARGE: 'recharge', WITHDRAW: 'withdraw', TRANSFER: 'transfer', RECEIPT: 'receipt', PAYMENT: 'payment', REFUND: 'refund', RED_PACKET: 'redpacket' }
  const typeColors = { RECHARGE: '#f6ffed', WITHDRAW: '#fff1f0', TRANSFER: '#e6f7ff', RECEIPT: '#f6ffed', PAYMENT: '#fff7e6', REFUND: '#f9f0ff', RED_PACKET: '#fff1f0' }
  const typeTextColors = { RECHARGE: '#52c41a', WITHDRAW: '#f5222d', TRANSFER: '#1677ff', RECEIPT: '#52c41a', PAYMENT: '#fa8c16', REFUND: '#722ed1', RED_PACKET: '#f5222d' }
  const statusMap = {
    SUCCESS: { label: '成功', bg: '#f6ffed', color: '#52c41a' },
    PENDING: { label: '处理中', bg: '#fff7e6', color: '#fa8c16' },
    FAILED: { label: '失败', bg: '#fff1f0', color: '#f5222d' },
    REFUNDED: { label: '已退款', bg: '#f9f0ff', color: '#722ed1' },
  }

  try {
    const bills = await api('/bills')
    const bill = bills.find((b) => String(b.id) === String(billId))
    if (!bill) {
      document.getElementById('billDetailContent').innerHTML = '<div style="text-align:center;padding:48px 16px"><div style="display:flex;justify-content:center;margin-bottom:12px;opacity:0.4">' + icon('empty', 48) + '</div><div style="font-size:15px;color:var(--kb-text-secondary)">未找到该账单</div></div>'
      return
    }

    const iconName = typeIcons[bill.type] || 'receipt'
    const bgColor = typeColors[bill.type] || '#f5f5f5'
    const textColor = typeTextColors[bill.type] || '#666'
    const isIncome = bill.direction === 'INCOME'
    const status = statusMap[bill.status] || { label: bill.status || '-', bg: '#f5f5f5', color: '#666' }

    let relatedHtml = ''
    if (bill.type === 'TRANSFER' && bill.relatedBillId) {
      const related = bills.find((b) => String(b.id) === String(bill.relatedBillId))
      if (related) {
        const rIconName = typeIcons[related.type] || 'receipt'
        const rBg = typeColors[related.type] || '#f5f5f5'
        const rColor = typeTextColors[related.type] || '#666'
        relatedHtml = `
          <div class="kb-related-card">
            <div class="kb-related-title">关联账单</div>
            <div class="kb-related-item" data-bill-id="${related.id}" style="cursor:pointer">
              <div class="kb-related-icon" style="background:${rBg};color:${rColor}">${icon(rIconName, 18)}</div>
              <div class="kb-related-info">
                <div class="kb-related-type">${fmtType(related.type)}${related.counterparty ? ' · ' + escapeHtml(related.counterparty) : ''}</div>
                <div class="kb-related-meta">${fmtTime(related.createdAt)}</div>
              </div>
              <div class="kb-related-amount ${related.direction === 'INCOME' ? 'income' : 'expense'}">${related.direction === 'INCOME' ? '+' : '-'}${fmtMoney(related.amountYuan)}</div>
            </div>
          </div>
        `
      }
    }

    document.getElementById('billDetailContent').innerHTML = `
      <div class="kb-detail-hero">
        <div class="kb-hero-icon" style="background:${bgColor};color:${textColor}">${icon(iconName, 28)}</div>
        <div class="kb-hero-type">${fmtType(bill.type)}</div>
        <div class="kb-hero-amount ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '-'}${fmtMoney(bill.amountYuan)}</div>
      </div>

      <div class="kb-detail-section">
        <div class="kb-detail-row">
          <div class="kb-detail-label">状态</div>
          <div class="kb-detail-value">
            <span class="kb-status-badge" style="background:${status.bg};color:${status.color}">${status.label}</span>
          </div>
        </div>
        <div class="kb-detail-row">
          <div class="kb-detail-label">时间</div>
          <div class="kb-detail-value">${bill.createdAt ? new Date(bill.createdAt).toLocaleString('zh-CN') : '-'}</div>
        </div>
        <div class="kb-detail-row">
          <div class="kb-detail-label">订单号</div>
          <div class="kb-detail-value" style="font-family:monospace;font-size:13px">${bill.id || '-'}</div>
        </div>
        ${bill.counterparty ? `
          <div class="kb-detail-row">
            <div class="kb-detail-label">对方</div>
            <div class="kb-detail-value">${bill.counterparty}</div>
          </div>
        ` : ''}
        ${bill.remark ? `
          <div class="kb-detail-row">
            <div class="kb-detail-label">备注</div>
            <div class="kb-detail-value">${bill.remark}</div>
          </div>
        ` : ''}
        <div class="kb-detail-row">
          <div class="kb-detail-label">类型</div>
          <div class="kb-detail-value">${fmtType(bill.type)} · ${isIncome ? '收入' : '支出'}</div>
        </div>
      </div>

      ${relatedHtml}
    `

    const relatedItem = document.querySelector('[data-bill-id]')
    if (relatedItem) {
      relatedItem.onclick = () => navigate('billDetail?id=' + relatedItem.getAttribute('data-bill-id'))
    }
  } catch (e) {
    document.getElementById('billDetailContent').innerHTML = `<div style="text-align:center;padding:48px 16px"><div style="display:flex;justify-content:center;margin-bottom:12px;opacity:0.4">${icon('empty', 48)}</div><div style="font-size:15px;color:var(--kb-text-secondary)">加载失败：${e.message}</div></div>`
  }
}

// 提现
async function renderWithdraw() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-withdraw-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 56px;color:#fff;position:relative;overflow:hidden}
        .kb-withdraw-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-withdraw-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-withdraw-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-withdraw-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-withdraw-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-withdraw-header .kb-placeholder{width:32px}
        .kb-withdraw-balance{position:relative;z-index:1}
        .kb-withdraw-balance .kb-label{font-size:13px;opacity:0.75;margin-bottom:6px}
        .kb-withdraw-balance .kb-amount{font-size:32px;font-weight:700;letter-spacing:-0.5px;margin-bottom:8px;font-variant-numeric:tabular-nums;line-height:1.1}
        .kb-withdraw-content{margin:-36px 16px 0;position:relative;z-index:2}
        .kb-withdraw-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(15,23,42,0.07);margin-bottom:12px}
        .kb-withdraw-notice{background:var(--kb-warning-light);border:1px solid #fde68a;color:#92400e;padding:10px 14px;border-radius:var(--kb-radius-md);font-size:13px;margin-bottom:20px;display:flex;align-items:flex-start;gap:8px;line-height:1.5}
        .kb-withdraw-notice-icon{flex-shrink:0;margin-top:1px}
        .kb-withdraw-notice-icon svg{width:16px;height:16px}
        .kb-records-card{background:#fff;border-radius:16px;padding:4px 0;box-shadow:0 2px 12px rgba(15,23,42,0.04)}
        .kb-records-title{padding:14px 16px 8px;font-size:13px;font-weight:600;color:var(--kb-text)}
        .kb-record-item{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--kb-border-light)}
        .kb-record-item:last-child{border-bottom:none}
        .kb-record-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--kb-error-light);color:var(--kb-error);flex-shrink:0}
        .kb-record-icon svg{width:18px;height:18px}
        .kb-record-info{flex:1;min-width:0}
        .kb-record-title{font-size:14px;font-weight:500;color:var(--kb-text)}
        .kb-record-meta{font-size:12px;color:var(--kb-text-tertiary);margin-top:2px}
        .kb-record-amount{font-size:15px;font-weight:600;color:var(--kb-text)}
        .kb-record-status{font-size:11px;font-weight:500;margin-top:2px;text-align:right}
        .kb-record-status.pending{color:var(--kb-warning)}
        .kb-record-status.success{color:var(--kb-success)}
        .kb-record-status.rejected{color:var(--kb-error)}
        .kb-btn-group{display:flex;gap:10px;margin-top:12px}
        .kb-btn-group .btn{flex:1}
      </style>

      <div class="kb-withdraw-hero">
        <div class="kb-withdraw-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">余额提现</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-withdraw-balance">
          <div class="kb-label">可提现余额（元）</div>
          <div class="kb-amount" id="availableBalance">--</div>
        </div>
      </div>

      <div class="kb-withdraw-content">
        <div class="kb-withdraw-card">
          <div class="kb-withdraw-notice">
            <span class="kb-withdraw-notice-icon">${icon('help', 16)}</span>
            <span>MVP 提现需后台审核，申请后金额进入冻结状态。</span>
          </div>

          <div class="form-group">
            <label class="form-label">提现金额</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:20px;font-weight:600;color:var(--kb-text-secondary)">¥</span>
              <input class="form-input" id="amount" type="number" placeholder="0.00" step="0.01" min="0.01" style="padding-left:36px;font-size:24px;font-weight:700;text-align:center">
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-bottom:16px">
            <button class="kb-quick-amount" id="btnWithdrawAll" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--kb-border);background:var(--kb-bg);font-size:13px;color:var(--kb-primary);cursor:pointer">全部提现</button>
          </div>

          <div class="form-group">
            <label class="form-label">到账账户</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('bank', 18)}</span>
              <input class="form-input" id="channelAccount" placeholder="例如：支付宝账号" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">支付密码</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
              <input class="form-input" id="payPassword" type="password" placeholder="请输入6位支付密码" maxlength="6" style="padding-left:42px;padding-right:46px;font-size:16px;letter-spacing:4px">
              <button type="button" id="togglePayPwd" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eyeOff', 18)}</button>
            </div>
          </div>

          <div class="kb-btn-group">
            <button class="btn btn-secondary" id="btnRecords">提现记录</button>
            <button class="btn btn-primary" id="btnWithdraw">申请提现</button>
          </div>
        </div>

        <div class="kb-records-card" id="withdrawRecords" style="display:none">
          <div class="kb-records-title">提现记录</div>
          <div id="recordsList"></div>
        </div>
      </div>
    </div>
  `

  try {
    const account = await api('/accounts/me')
    document.getElementById('availableBalance').textContent = fmtMoney(account.availableBalanceYuan)
  } catch (e) { /* ignore */ }

  document.getElementById('btnWithdrawAll').onclick = async () => {
    try {
      const account = await api('/accounts/me')
      document.getElementById('amount').value = fmtMoney(account.availableBalanceYuan)
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  document.getElementById('togglePayPwd').onclick = () => {
    const input = document.getElementById('payPassword')
    const btn = document.getElementById('togglePayPwd')
    if (input.type === 'password') { input.type = 'text'; btn.innerHTML = icon('eye', 18) }
    else { input.type = 'password'; btn.innerHTML = icon('eyeOff', 18) }
  }

  document.getElementById('btnWithdraw').onclick = async () => {
    const amount = Number(document.getElementById('amount').value)
    const channelAccount = document.getElementById('channelAccount').value.trim()
    const payPassword = document.getElementById('payPassword').value
    if (!amount || amount <= 0) { showToast('请输入正确的提现金额'); return }
    if (!channelAccount) { showToast('请输入到账账户'); return }
    if (!payPassword) { showToast('请输入支付密码'); return }
    const btn = document.getElementById('btnWithdraw')
    btn.disabled = true
    btn.textContent = '提交中...'
    try {
      await api('/withdrawals', { method: 'POST', body: JSON.stringify({ amount, channelAccount, payPassword }) })
      showToast('提现申请已提交，等待审核', 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
      btn.disabled = false
      btn.textContent = '申请提现'
    }
  }

  document.getElementById('btnRecords').onclick = async () => {
    const container = document.getElementById('withdrawRecords')
    const list = document.getElementById('recordsList')
    container.style.display = 'block'
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--kb-text-tertiary);font-size:13px">加载中...</div>'
    try {
      const records = await api('/withdrawals')
      if (records.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:32px 16px"><div style="display:flex;justify-content:center;margin-bottom:8px;opacity:0.4">${icon('empty', 40)}</div><div style="font-size:14px;color:var(--kb-text-secondary)">暂无提现记录</div></div>`
      } else {
        const statusMap = {
          PENDING: { label: '审核中', cls: 'pending' },
          APPROVED: { label: '已通过', cls: 'success' },
          REJECTED: { label: '已拒绝', cls: 'rejected' },
          SUCCESS: { label: '已到账', cls: 'success' },
        }
        list.innerHTML = records.map(r => {
          const st = statusMap[r.status] || { label: r.status, cls: '' }
          return `
            <div class="kb-record-item">
              <div class="kb-record-icon">${icon('withdraw', 18)}</div>
              <div class="kb-record-info">
                <div class="kb-record-title">提现到${escapeHtml(r.channelAccount || '账户')}</div>
                <div class="kb-record-meta">${fmtTime(r.createdAt)}</div>
              </div>
              <div style="text-align:right">
                <div class="kb-record-amount">-¥${fmtMoney(r.amountYuan || r.amount / 100)}</div>
                <div class="kb-record-status ${st.cls}">${st.label}</div>
              </div>
            </div>
          `
        }).join('')
      }
    } catch (e) {
      list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--kb-error);font-size:13px">加载失败：${e.message}</div>`
    }
  }
}

// 红包
function renderRedPacket() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:#fff5f0;min-height:100vh">
      <style>
        .kb-redpacket-hero{background:linear-gradient(135deg,#ff4d4f 0%,#cf1322 100%);padding:calc(var(--kb-safe-area-top) + 8px) 20px 80px;color:#fff;position:relative;overflow:hidden}
        .kb-redpacket-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,215,0,0.25) 0%,rgba(255,215,0,0) 65%);border-radius:50%;pointer-events:none}
        .kb-redpacket-hero::after{content:'';position:absolute;bottom:-40px;left:-30px;width:160px;height:160px;background:radial-gradient(circle,rgba(255,255,255,0.15) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-redpacket-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-redpacket-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.2);color:#fff}
        .kb-redpacket-header .kb-back:active{background:rgba(255,255,255,0.3)}
        .kb-redpacket-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-redpacket-header .kb-placeholder{width:32px}
        .kb-redpacket-icon{text-align:center;margin-bottom:12px;position:relative;z-index:1}
        .kb-redpacket-icon-circle{width:64px;height:64px;margin:0 auto;background:rgba(255,215,0,0.25);border-radius:50%;display:flex;align-items:center;justify-content:center}
        .kb-redpacket-form{margin:-56px 16px 0;position:relative;z-index:2}
        .kb-redpacket-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(207,19,34,0.1)}
        .kb-redpacket-btn{width:100%;height:50px;border-radius:25px;border:none;background:linear-gradient(135deg,#ff4d4f,#cf1322);color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 4px 12px rgba(207,19,34,0.3)}
        .kb-redpacket-btn:active{transform:scale(0.98);box-shadow:0 2px 6px rgba(207,19,34,0.3)}
        .kb-redpacket-btn:disabled{opacity:0.6;transform:none}
        .kb-redpacket-received{margin:20px 16px 0}
        .kb-redpacket-received-card{background:#fff;border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(15,23,42,0.05)}
        .kb-redpacket-section-title{font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px;display:flex;align-items:center;gap:6px}
        .kb-redpacket-item{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--kb-border)}
        .kb-redpacket-item:last-child{border-bottom:none}
        .kb-redpacket-item-left{display:flex;align-items:center;gap:12px}
        .kb-redpacket-item-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#ffd666,#ffadd2);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:14px}
        .kb-redpacket-item-info .kb-name{font-size:14px;font-weight:500;color:var(--kb-text);margin-bottom:2px}
        .kb-redpacket-item-info .kb-meta{font-size:12px;color:var(--kb-text-tertiary)}
        .kb-redpacket-item-right{text-align:right}
        .kb-redpacket-item-right .kb-amount{font-size:16px;font-weight:700;color:#cf1322;font-variant-numeric:tabular-nums}
        .kb-redpacket-empty{text-align:center;padding:40px 20px;color:var(--kb-text-tertiary)}
        .kb-redpacket-empty .kb-empty-icon{margin-bottom:12px;display:flex;justify-content:center;opacity:0.4}
      </style>

      <div class="kb-redpacket-hero">
        <div class="kb-redpacket-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">发红包</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-redpacket-icon">
          <div class="kb-redpacket-icon-circle">${icon('redpacket', 36)}</div>
        </div>
      </div>

      <div class="kb-redpacket-form">
        <div class="kb-redpacket-card">
          <div class="form-group">
            <label class="form-label">红包金额</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:20px;font-weight:600;color:#cf1322">¥</span>
              <input class="form-input" id="amount" type="number" placeholder="0.00" step="0.01" min="0.01" style="padding-left:36px;font-size:24px;font-weight:700;text-align:center;border-color:#ffccc7">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">祝福语</label>
            <input class="form-input" id="remark" placeholder="恭喜发财，大吉大利" value="恭喜发财，大吉大利" maxlength="30">
          </div>
          <div class="form-group">
            <label class="form-label">支付密码</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
              <input class="form-input" id="payPassword" type="password" placeholder="请输入6位支付密码" maxlength="6" style="padding-left:42px;padding-right:46px;letter-spacing:4px">
              <button type="button" id="togglePayPwd" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--kb-text-tertiary);user-select:none;background:none;border:none;padding:6px;display:flex;align-items:center">${icon('eyeOff', 18)}</button>
            </div>
          </div>
          <button class="kb-redpacket-btn" id="btnSend">塞钱进红包</button>
        </div>
      </div>

      <div class="kb-redpacket-received">
        <div class="kb-redpacket-received-card">
          <div class="kb-redpacket-section-title">
            ${icon('redpacket', 18)}
            <span>收到的红包</span>
          </div>
          <div id="receivedPackets"></div>
        </div>
      </div>
    </div>
  `

  document.getElementById('togglePayPwd').onclick = () => {
    const input = document.getElementById('payPassword')
    const btn = document.getElementById('togglePayPwd')
    if (input.type === 'password') { input.type = 'text'; btn.innerHTML = icon('eye', 18) }
    else { input.type = 'password'; btn.innerHTML = icon('eyeOff', 18) }
  }

  document.getElementById('btnSend').onclick = async () => {
    const amount = Number(document.getElementById('amount').value)
    const remark = document.getElementById('remark').value || '恭喜发财，大吉大利'
    const payPassword = document.getElementById('payPassword').value
    if (!amount || amount <= 0) { showToast('请输入正确的红包金额'); return }
    if (!payPassword) { showToast('请输入支付密码'); return }
    const btn = document.getElementById('btnSend')
    btn.disabled = true
    btn.textContent = '生成中...'
    try {
      const packet = await api('/red-packets', { method: 'POST', body: JSON.stringify({ amount, remark, payPassword }) })
      showToast(`红包已生成，编号：${packet.packetNo}`, 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
      btn.disabled = false
      btn.textContent = '塞钱进红包'
    }
  }

  ;(async () => {
    try {
      const received = await api('/red-packets/received')
      const container = document.getElementById('receivedPackets')
      if (!received || received.length === 0) {
        container.innerHTML = `
          <div class="kb-redpacket-empty">
            <div class="kb-empty-icon">${icon('empty', 48)}</div>
            <div style="font-size:14px">暂无收到的红包</div>
          </div>
        `
      } else {
        container.innerHTML = received.map(r => {
          const name = (r.redPacket && r.redPacket.sender && r.redPacket.sender.nickname) ? r.redPacket.sender.nickname : '红包'
          const initial = name.charAt(0)
          const remark = (r.redPacket && r.redPacket.remark) ? r.redPacket.remark : ''
          return `
            <div class="kb-redpacket-item">
              <div class="kb-redpacket-item-left">
                <div class="kb-redpacket-item-avatar">${initial}</div>
                <div class="kb-redpacket-item-info">
                  <div class="kb-name">来自${name}的红包</div>
                  <div class="kb-meta">${fmtTime(r.createdAt)}${remark ? ' · ' + remark : ''}</div>
                </div>
              </div>
              <div class="kb-redpacket-item-right">
                <div class="kb-amount">+${fmtMoney(r.amount / 100)}</div>
              </div>
            </div>
          `
        }).join('')
      }
    } catch (e) {
      document.getElementById('receivedPackets').innerHTML = `
        <div class="kb-redpacket-empty">
          <div style="font-size:13px;color:var(--kb-text-tertiary)">加载失败</div>
        </div>
      `
    }
  })()
}

// 收款码
async function renderQrCode() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-qrcode-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 100px;color:#fff;position:relative;overflow:hidden}
        .kb-qrcode-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,255,255,0.12) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-qrcode-hero::after{content:'';position:absolute;bottom:-80px;left:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-qrcode-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;position:relative;z-index:1}
        .kb-qrcode-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-qrcode-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-qrcode-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-qrcode-header .kb-placeholder{width:32px}
        .kb-qrcode-main{margin:-76px 16px 0;position:relative;z-index:2}
        .kb-qrcode-card{background:#fff;border-radius:20px;padding:28px 24px;box-shadow:0 8px 30px rgba(15,23,42,0.12);text-align:center}
        .kb-qrcode-icon-wrap{width:80px;height:80px;margin:0 auto 16px;background:linear-gradient(135deg,#e6f4ff,#bae0ff);border-radius:20px;display:flex;align-items:center;justify-content:center}
        .kb-qrcode-code{font-size:28px;font-weight:800;color:var(--kb-primary);letter-spacing:2px;margin-bottom:8px;font-variant-numeric:tabular-nums}
        .kb-qrcode-tip{font-size:13px;color:var(--kb-text-secondary);margin-bottom:20px;line-height:1.5}
        .kb-qrcode-btn{width:100%;height:46px;border-radius:23px;border:1.5px solid var(--kb-primary);background:#fff;color:var(--kb-primary);font-size:15px;font-weight:600;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px}
        .kb-qrcode-btn:active{background:var(--kb-primary);color:#fff}
        .kb-qrcode-fixed{margin:20px 16px 0}
        .kb-qrcode-fixed-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(15,23,42,0.05)}
        .kb-qrcode-fixed-result{margin-top:16px;padding:20px;background:linear-gradient(135deg,#f6ffed,#d9f7be);border-radius:12px;text-align:center}
        .kb-qrcode-fixed-result .kb-code{font-size:24px;font-weight:800;color:#389e0d;letter-spacing:2px;font-variant-numeric:tabular-nums}
        .kb-qrcode-fixed-result .kb-label{font-size:12px;color:#52c41a;margin-top:4px}
      </style>

      <div class="kb-qrcode-hero">
        <div class="kb-qrcode-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">我的收款码</div>
          <div class="kb-placeholder"></div>
        </div>
      </div>

      <div class="kb-qrcode-main">
        <div class="kb-qrcode-card">
          <div class="kb-qrcode-icon-wrap">${icon('qrcode', 44)}</div>
          <div class="kb-qrcode-code" id="codeText">--</div>
          <div class="kb-qrcode-tip">让对方在「扫码付款」输入此编号<br/>即可向你付款</div>
          <button class="kb-qrcode-btn" id="btnCopyCode">${icon('copy', 16)} 复制收款码</button>
          <button class="kb-qrcode-btn" id="btnFixed" style="margin-top:10px">${icon('plus', 16)} 生成固定金额收款码</button>
        </div>
      </div>

      <div class="kb-qrcode-fixed" id="fixedCodeArea" style="display:none">
        <div class="kb-qrcode-fixed-card">
          <div style="font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:16px;display:flex;align-items:center;gap:6px">
            ${icon('qrcode', 18)} 固定金额收款码
          </div>
          <div class="form-group">
            <label class="form-label">收款金额</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:18px;font-weight:600;color:var(--kb-text-secondary)">¥</span>
              <input class="form-input" id="fixedAmount" type="number" placeholder="0.00" step="0.01" min="0.01" style="padding-left:36px">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">备注</label>
            <input class="form-input" id="fixedRemark" placeholder="例如：餐费、AA收款" maxlength="30">
          </div>
          <button class="btn btn-primary" id="btnCreateFixed" style="height:46px;font-size:15px;font-weight:600">生成收款码</button>
          <div id="fixedResult"></div>
        </div>
      </div>
    </div>
  `
  try {
    const code = await api('/qr-codes/personal')
    document.getElementById('codeText').textContent = code.code
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
  document.getElementById('btnCopyCode').onclick = () => {
    const code = document.getElementById('codeText').textContent
    navigator.clipboard?.writeText(code).then(() => showToast('已复制到剪贴板', 'success')).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      showToast('已复制到剪贴板', 'success')
    })
  }
  document.getElementById('btnFixed').onclick = () => {
    const area = document.getElementById('fixedCodeArea')
    area.style.display = area.style.display === 'none' ? 'block' : 'none'
  }
  document.getElementById('btnCreateFixed').onclick = async () => {
    const amount = Number(document.getElementById('fixedAmount').value)
    const remark = document.getElementById('fixedRemark').value
    if (!amount || amount <= 0) { showToast('请输入正确的金额'); return }
    const btn = document.getElementById('btnCreateFixed')
    btn.disabled = true
    btn.textContent = '生成中...'
    try {
      const code = await api('/qr-codes/fixed', { method: 'POST', body: JSON.stringify({ amount, remark }) })
      document.getElementById('fixedResult').innerHTML = `
        <div class="kb-qrcode-fixed-result">
          <div class="kb-code">${code.code}</div>
          <div class="kb-label">固定金额收款码 · ¥${fmtMoney(amount)}</div>
        </div>
      `
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    } finally {
      btn.disabled = false
      btn.textContent = '生成收款码'
    }
  }
}

// 扫码付款
function renderPayByQr() {
  app.innerHTML = `
    <div class="page">
      <div class="kb-page-header" style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff"><button class="kb-back-btn" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)" onclick="history.back()">${icon('back',18)}</button><h1 style="font-size:17px;font-weight:600;margin:0">扫码付款</h1><div style="width:32px"></div></div>
      <div class="card">
        <div class="form-group">
          <label class="form-label">收款码编号</label>
          <input class="form-input" id="code" placeholder="请输入 KB- 开头的收款码">
        </div>
        <div class="form-group">
          <label class="form-label">付款金额（元）</label>
          <input class="form-input" id="amount" type="number" placeholder="固定金额码可不填">
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input class="form-input" id="remark" placeholder="可选">
        </div>
        <div class="form-group">
          <label class="form-label">支付密码</label>
          <input class="form-input" id="payPassword" type="password" placeholder="请输入支付密码" maxlength="6">
        </div>
        <button class="btn btn-primary" id="btnPay">确认付款</button>
      </div>
    </div>
  `
  document.getElementById('btnPay').onclick = async () => {
    const amount = document.getElementById('amount').value
    const body = {
      code: document.getElementById('code').value,
      amount: amount ? Number(amount) : undefined,
      remark: document.getElementById('remark').value,
      payPassword: document.getElementById('payPassword').value,
    }
    try {
      await api('/qr-codes/pay', { method: 'POST', body: JSON.stringify(body) })
      showToast('付款成功', 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }
}

// 重置支付密码
function renderResetPayPassword() {
  app.innerHTML = `
    <div class="page">
      <div class="kb-page-header" style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff"><button class="kb-back-btn" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)" onclick="history.back()">${icon('back',18)}</button><h1 style="font-size:17px;font-weight:600;margin:0">重置支付密码</h1><div style="width:32px"></div></div>
      <div class="card">
        <div class="form-group">
          <label class="form-label">真实姓名</label>
          <input class="form-input" id="realName" placeholder="请输入实名姓名">
        </div>
        <div class="form-group">
          <label class="form-label">身份证号</label>
          <input class="form-input" id="idCard" placeholder="请输入身份证号">
        </div>
        <div class="form-group">
          <label class="form-label">新支付密码（6位数字）</label>
          <input class="form-input" id="newPayPassword" type="password" placeholder="请设置新支付密码" maxlength="6">
        </div>
        <button class="btn btn-primary" id="btnReset">重置</button>
      </div>
    </div>
  `
  document.getElementById('btnReset').onclick = async () => {
    const body = {
      realName: document.getElementById('realName').value,
      idCard: document.getElementById('idCard').value,
      newPayPassword: document.getElementById('newPayPassword').value,
    }
    try {
      await api('/users/reset-pay-password', { method: 'POST', body: JSON.stringify(body) })
      showToast('支付密码重置成功', 'success')
      navigate('home')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }
}

async function renderProfile() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 80px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-profile-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 12px) 20px 70px;color:#fff;position:relative;overflow:hidden}
        .kb-profile-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-profile-hero::after{content:'';position:absolute;bottom:-50px;left:-40px;width:160px;height:160px;background:radial-gradient(circle,rgba(255,255,255,0.07) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-profile-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-profile-title{font-size:20px;font-weight:700;letter-spacing:0.5px}
        .kb-settings-btn{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;border:none;color:#fff}
        .kb-settings-btn:active{background:rgba(255,255,255,0.25)}
        .kb-user-info{display:flex;align-items:center;gap:14px;position:relative;z-index:1}
        .kb-user-avatar{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;flex-shrink:0;color:#fff;border:2px solid rgba(255,255,255,0.3)}
        .kb-user-meta{flex:1;min-width:0}
        .kb-user-name-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
        .kb-user-name{font-size:20px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .kb-verify-badge{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:12px;background:rgba(255,255,255,0.2);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-size:11px;font-weight:500;white-space:nowrap}
        .kb-verify-badge.verified{background:rgba(16,185,129,0.3)}
        .kb-verify-badge svg{width:12px;height:12px}
        .kb-user-id{display:inline-block;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.15);font-size:11px;font-family:monospace;opacity:0.9}
        .kb-profile-content{margin:-50px 16px 0;position:relative;z-index:2}
        .kb-stats-card{background:#fff;border-radius:16px;padding:20px 0;box-shadow:0 4px 20px rgba(15,23,42,0.07);margin-bottom:14px;display:flex}
        .kb-stat-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;border:none;background:none;padding:4px 0;transition:opacity 0.15s}
        .kb-stat-item:active{opacity:0.7}
        .kb-stat-value{font-size:20px;font-weight:700;color:var(--kb-text);font-variant-numeric:tabular-nums}
        .kb-stat-label{font-size:12px;color:var(--kb-text-tertiary)}
        .kb-stat-divider{width:1px;background:var(--kb-border-light);margin:4px 0}
        .kb-menu-card{background:#fff;border-radius:16px;padding:4px 0;box-shadow:0 2px 12px rgba(15,23,42,0.04);margin-bottom:14px}
        .kb-menu-group-title{padding:14px 16px 8px;font-size:12px;color:var(--kb-text-tertiary);font-weight:500}
        .kb-profile-link{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:none;background:none;cursor:pointer;transition:background 0.15s;text-align:left}
        .kb-profile-link:active{background:var(--kb-bg-elevated)}
        .kb-link-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .kb-link-icon svg{width:18px;height:18px}
        .kb-link-icon.blue{background:#eff6ff;color:#2563eb}
        .kb-link-icon.green{background:#ecfdf5;color:#059669}
        .kb-link-icon.red{background:#fef2f2;color:#dc2626}
        .kb-link-icon.orange{background:#fffbeb;color:#d97706}
        .kb-link-icon.purple{background:#faf5ff;color:#7c3aed}
        .kb-link-icon.gray{background:#f1f5f9;color:#64748b}
        .kb-link-content{flex:1;min-width:0}
        .kb-link-title{font-size:15px;color:var(--kb-text);font-weight:500}
        .kb-link-desc{font-size:12px;color:var(--kb-text-tertiary);margin-top:2px}
        .kb-link-extra{font-size:13px;color:var(--kb-text-tertiary);margin-right:4px;white-space:nowrap}
        .kb-link-arrow{color:var(--kb-text-tertiary);opacity:0.4;flex-shrink:0;display:flex;align-items:center}
        .kb-link-arrow svg{width:16px;height:16px}
        .kb-logout-card{background:#fff;border-radius:16px;padding:4px 0;box-shadow:0 2px 12px rgba(15,23,42,0.04)}
        .kb-logout-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:18px 16px;border:none;background:none;cursor:pointer;color:var(--kb-error);font-size:15px;font-weight:500;transition:background 0.15s}
        .kb-logout-btn:active{background:#fef2f2}
        .kb-logout-btn svg{width:18px;height:18px}
        .kb-bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;border-top:1px solid var(--kb-border-light);padding:8px 0 calc(8px + env(safe-area-inset-bottom));z-index:100}
        .kb-nav-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0;cursor:pointer;color:var(--kb-text-tertiary);transition:color 0.2s;border:none;background:none}
        .kb-nav-item.active{color:var(--kb-primary)}
        .kb-nav-item svg{width:22px;height:22px}
        .kb-nav-label{font-size:10px;font-weight:500}
        .kb-profile-skeleton{background:linear-gradient(90deg,var(--kb-bg-elevated) 25%,var(--kb-border-light) 50%,var(--kb-bg-elevated) 75%);background-size:200% 100%;animation:kb-shimmer 1.5s infinite;border-radius:8px}
        @keyframes kb-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .kb-profile-error{text-align:center;padding:48px 20px}
        .kb-profile-error .kb-error-icon{margin-bottom:16px;opacity:0.4}
        .kb-profile-error .kb-error-icon svg{width:56px;height:56px}
        .kb-profile-error .kb-error-text{font-size:14px;color:var(--kb-text-tertiary);margin-bottom:16px}
        .kb-retry-btn{padding:10px 24px;border-radius:20px;background:var(--kb-primary);color:#fff;border:none;font-size:14px;font-weight:500;cursor:pointer}
      </style>

      <div class="kb-profile-hero">
        <div class="kb-profile-top">
          <div class="kb-profile-title">我的</div>
          <button class="kb-settings-btn" data-action="settings" title="设置">
            ${icon('settings', 18)}
          </button>
        </div>
        <div class="kb-user-info" id="userInfoArea">
          <div class="kb-profile-skeleton" style="width:60px;height:60px;border-radius:50%"></div>
          <div class="kb-user-meta">
            <div class="kb-profile-skeleton" style="width:120px;height:24px;margin-bottom:8px;border-radius:6px"></div>
            <div class="kb-profile-skeleton" style="width:80px;height:18px;border-radius:9px"></div>
          </div>
        </div>
      </div>

      <div class="kb-profile-content" id="profileContent">
        <div class="kb-stats-card">
          <div class="kb-profile-skeleton" style="flex:1;height:50px;margin:0 16px;border-radius:8px"></div>
        </div>
        <div class="kb-menu-card">
          <div class="kb-profile-skeleton" style="height:60px;margin:8px"></div>
          <div class="kb-profile-skeleton" style="height:60px;margin:8px"></div>
        </div>
      </div>

      <div class="kb-bottom-nav">
        <button class="kb-nav-item" data-nav="home">
          ${icon('home', 22)}
          <div class="kb-nav-label">首页</div>
        </button>
        <button class="kb-nav-item" data-nav="wallet">
          ${icon('wallet', 22)}
          <div class="kb-nav-label">钱包</div>
        </button>
        <button class="kb-nav-item" data-nav="bills">
          ${icon('bill', 22)}
          <div class="kb-nav-label">账单</div>
        </button>
        <button class="kb-nav-item active" data-nav="profile">
          ${icon('user', 22)}
          <div class="kb-nav-label">我的</div>
        </button>
      </div>
    </div>
  `

  const bindEvents = () => {
    document.querySelectorAll('[data-go]').forEach((el) => {
      el.onclick = () => navigate(el.getAttribute('data-go'))
    })
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.onclick = () => navigate(el.getAttribute('data-nav'))
    })
    const settingsBtn = document.querySelector('[data-action="settings"]')
    if (settingsBtn) {
      settingsBtn.onclick = () => navigate('security')
    }
  }

  bindEvents()

  const loadData = async () => {
    try {
      const [userRes, accountRes, billsRes] = await Promise.all([
        api('/users/me'),
        api('/accounts/me'),
        api('/bills'),
      ])
      currentUser = userRes
      currentAccount = accountRes

      const statusMap = { UNVERIFIED: '未认证', PENDING: '审核中', VERIFIED: '已认证', REJECTED: '已拒绝' }
      const realNameStatus = statusMap[userRes.realNameStatus] || '未认证'
      const isVerified = userRes.realNameStatus === 'VERIFIED'
      const initials = (userRes.nickname || '用').charAt(0).toUpperCase()
      const shortUserId = userRes.id.length > 8 ? userRes.id.slice(0, 8) + '...' : userRes.id
      const incomeCount = billsRes.filter(b => b.direction === 'INCOME').length

      document.getElementById('userInfoArea').innerHTML = `
        <div class="kb-user-avatar">${initials}</div>
        <div class="kb-user-meta">
          <div class="kb-user-name-row">
            <div class="kb-user-name">${escapeHtml(userRes.nickname) || '未设置昵称'}</div>
            <div class="kb-verify-badge ${isVerified ? 'verified' : ''}">
              ${icon('check', 12)}
              ${realNameStatus}
            </div>
          </div>
          <div class="kb-user-id">ID: ${shortUserId}</div>
        </div>
      `

      document.getElementById('profileContent').innerHTML = `
        <div class="kb-stats-card">
          <button class="kb-stat-item" data-go="wallet">
            <div class="kb-stat-value">${fmtMoney(accountRes.totalBalanceYuan)}</div>
            <div class="kb-stat-label">总资产（元）</div>
          </button>
          <div class="kb-stat-divider"></div>
          <button class="kb-stat-item" data-go="bills">
            <div class="kb-stat-value">${billsRes.length}</div>
            <div class="kb-stat-label">账单数</div>
          </button>
          <div class="kb-stat-divider"></div>
          <button class="kb-stat-item" data-go="bills">
            <div class="kb-stat-value">${incomeCount}</div>
            <div class="kb-stat-label">收入笔数</div>
          </button>
        </div>

        <div class="kb-menu-card">
          <div class="kb-menu-group-title">账户管理</div>
          <button class="kb-profile-link" data-action="editProfile">
            <div class="kb-link-icon blue">${icon('user', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">个人资料</div>
              <div class="kb-link-desc">修改昵称、邮箱等信息</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
          <button class="kb-profile-link" data-go="security">
            <div class="kb-link-icon purple">${icon('lock', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">账户安全</div>
              <div class="kb-link-desc">密码、绑定管理</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
          <button class="kb-profile-link" data-go="identity">
            <div class="kb-link-icon ${isVerified ? 'green' : 'orange'}">${icon('check', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">实名认证</div>
              <div class="kb-link-desc">${userRes.realName ? escapeHtml(userRes.realName.charAt(0)) + '**' : '未认证'}</div>
            </div>
            <div class="kb-link-extra" style="color:${isVerified ? 'var(--kb-success)' : 'var(--kb-warning)'}">${realNameStatus}</div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
        </div>

        <div class="kb-menu-card">
          <div class="kb-menu-group-title">资金管理</div>
          <button class="kb-profile-link" data-go="recharge">
            <div class="kb-link-icon green">${icon('recharge', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">充值</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
          <button class="kb-profile-link" data-go="withdraw">
            <div class="kb-link-icon red">${icon('withdraw', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">提现</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
          <button class="kb-profile-link" data-go="transfer">
            <div class="kb-link-icon blue">${icon('transfer', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">转账</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
          <button class="kb-profile-link" data-go="redpacket">
            <div class="kb-link-icon red">${icon('redpacket', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">发红包</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
        </div>

        <div class="kb-menu-card">
          <div class="kb-menu-group-title">其他</div>
          <button class="kb-profile-link" data-go="merchantRegister">
            <div class="kb-link-icon orange">${icon('chart', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">商户入驻</div>
              <div class="kb-link-desc">开通商户收款功能</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
          <button class="kb-profile-link" data-go="qrcode">
            <div class="kb-link-icon gray">${icon('qrcode', 18)}</div>
            <div class="kb-link-content">
              <div class="kb-link-title">收款码</div>
              <div class="kb-link-desc">生成个人/固定收款码</div>
            </div>
            <div class="kb-link-arrow">${icon('chevronRight', 16)}</div>
          </button>
        </div>

        <div class="kb-logout-card">
          <button class="kb-logout-btn" data-action="logout">
            ${icon('logout', 18)}
            退出登录
          </button>
        </div>
      `

      bindEvents()

      const editBtn = document.querySelector('[data-action="editProfile"]')
      if (editBtn) {
        editBtn.onclick = () => {
          const bodyHtml = `
            <div class="form-group">
              <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">昵称</label>
              <input class="form-input" id="editNickname" value="${userRes.nickname || ''}" placeholder="请输入昵称" style="padding:10px 14px;font-size:14px">
            </div>
            <div class="form-group">
              <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">邮箱</label>
              <input class="form-input" id="editEmail" value="${userRes.email || ''}" placeholder="请输入邮箱" style="padding:10px 14px;font-size:14px">
            </div>
            <button class="btn btn-primary" id="btnSaveProfile" style="margin-top:8px;padding:10px;font-size:14px">保存</button>
          `
          const { close } = showModal('编辑资料', bodyHtml)
          document.getElementById('btnSaveProfile').onclick = async () => {
            const body = {
              nickname: document.getElementById('editNickname').value.trim(),
              email: document.getElementById('editEmail').value.trim() || undefined,
            }
            try {
              await api('/users/me', { method: 'PATCH', body: JSON.stringify(body) })
              close()
              showToast('资料已更新', 'success')
              renderProfile()
            } catch (e) {
              showToast(e.message || '操作失败', 'error')
            }
          }
        }
      }

      const logoutBtn = document.querySelector('[data-action="logout"]')
      if (logoutBtn) {
        logoutBtn.onclick = () => {
          localStorage.removeItem('kebaipay_token')
          sessionStorage.removeItem('kebaipay_token')
          token = null
          navigate('login')
        }
      }
    } catch (e) {
      document.getElementById('profileContent').innerHTML = `
        <div class="kb-profile-error">
          <div class="kb-error-icon">${icon('empty', 56)}</div>
          <div class="kb-error-text">加载失败：${e.message}</div>
          <button class="kb-retry-btn" id="btnRetry">重试</button>
        </div>
      `
      const retryBtn = document.getElementById('btnRetry')
      if (retryBtn) {
        retryBtn.onclick = () => renderProfile()
      }
    }
  }

  loadData()
}

// 安全设置页
async function renderSecurity() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-security-header{background:#fff;padding:calc(var(--kb-safe-area-top) + 8px) 20px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--kb-border)}
        .kb-security-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)}
        .kb-security-header .kb-back:active{background:var(--kb-border)}
        .kb-security-header .kb-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .kb-security-header .kb-placeholder{width:32px}
        .kb-security-content{padding:16px}
        .kb-security-card{background:#fff;border-radius:16px;padding:4px 0;margin-bottom:14px;box-shadow:0 2px 12px rgba(15,23,42,0.05);overflow:hidden}
        .kb-security-section-title{font-size:13px;color:var(--kb-text-tertiary);padding:12px 20px 8px;font-weight:500;letter-spacing:0.3px}
        .kb-security-item{display:flex;align-items:center;gap:14px;padding:14px 20px;cursor:pointer;transition:background 0.15s}
        .kb-security-item:active{background:var(--kb-bg)}
        .kb-security-item + .kb-security-item{border-top:1px solid var(--kb-border-light)}
        .kb-security-item-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .kb-security-item-info{flex:1;min-width:0}
        .kb-security-item-info .kb-name{font-size:15px;font-weight:500;color:var(--kb-text);margin-bottom:2px}
        .kb-security-item-info .kb-desc{font-size:12px;color:var(--kb-text-tertiary)}
        .kb-security-item-extra{font-size:13px;color:var(--kb-text-tertiary);display:flex;align-items:center;gap:4px}
        .kb-security-item-extra.kb-bound{color:var(--kb-success)}
        .kb-security-empty{text-align:center;padding:32px 20px;color:var(--kb-text-tertiary)}
        .kb-security-empty .kb-empty-icon{margin-bottom:8px;display:flex;justify-content:center;opacity:0.4}
      </style>

      <div class="kb-security-header">
        <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
        <div class="kb-title">安全设置</div>
        <div class="kb-placeholder"></div>
      </div>

      <div id="securityContent" class="kb-security-content">
        <div class="kb-security-card">
          <div class="skeleton" style="height:52px;margin:8px 20px"></div>
          <div class="skeleton" style="height:52px;margin:8px 20px"></div>
        </div>
      </div>
    </div>
  `

  try {
    const user = await api('/users/me')
    currentUser = user

    document.getElementById('securityContent').innerHTML = `
      <div class="kb-security-card" style="animation:fadeIn 0.3s ease-out">
        <div class="kb-security-section-title">密码安全</div>
        <div class="kb-security-item" id="btnChangeLoginPwd">
          <div class="kb-security-item-icon" style="background:var(--kb-primary-light);color:var(--kb-primary)">${icon('lock', 18)}</div>
          <div class="kb-security-item-info">
            <div class="kb-name">修改登录密码</div>
            <div class="kb-desc">定期修改密码以保护账户安全</div>
          </div>
          <div class="kb-security-item-extra">${icon('chevronRight', 16)}</div>
        </div>
        <div class="kb-security-item" id="btnChangePayPwd">
          <div class="kb-security-item-icon" style="background:#f6ffed;color:#52c41a">${icon('lock', 18)}</div>
          <div class="kb-security-item-info">
            <div class="kb-name">修改支付密码</div>
            <div class="kb-desc">6位数字密码，用于转账、提现</div>
          </div>
          <div class="kb-security-item-extra">${icon('chevronRight', 16)}</div>
        </div>
      </div>

      <div class="kb-security-card" style="animation:slideUp 0.3s ease-out 0.1s both">
        <div class="kb-security-section-title">绑定管理</div>
        <div class="kb-security-item" id="btnBindPhone">
          <div class="kb-security-item-icon" style="background:#e6f4ff;color:var(--kb-primary)">${icon('phone', 18)}</div>
          <div class="kb-security-item-info">
            <div class="kb-name">${user.phone ? '换绑手机号' : '绑定手机号'}</div>
            <div class="kb-desc">${user.phone ? `当前：${user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}` : '绑定手机号用于找回密码和安全验证'}</div>
          </div>
          <div class="kb-security-item-extra ${user.phone ? 'kb-bound' : ''}">
            ${user.phone ? '已绑定' : '未绑定'} ${icon('chevronRight', 16)}
          </div>
        </div>
        <div class="kb-security-item" id="btnBindEmail">
          <div class="kb-security-item-icon" style="background:#fff7e6;color:#fa8c16">${icon('mail', 18)}</div>
          <div class="kb-security-item-info">
            <div class="kb-name">${user.email ? '换绑邮箱' : '绑定邮箱'}</div>
            <div class="kb-desc">${user.email ? `当前：${user.email.replace(/(.{2}).+(@.+)/, '$1***$2')}` : '绑定邮箱用于接收通知和找回密码'}</div>
          </div>
          <div class="kb-security-item-extra ${user.email ? 'kb-bound' : ''}">
            ${user.email ? '已绑定' : '未绑定'} ${icon('chevronRight', 16)}
          </div>
        </div>
      </div>

      <div class="kb-security-card" style="animation:slideUp 0.3s ease-out 0.2s both">
        <div class="kb-security-section-title">登录设备</div>
        <div id="deviceList">
          <div class="kb-security-empty">
            <div class="kb-empty-icon">${icon('empty', 40)}</div>
            <div style="font-size:13px">暂无登录设备记录</div>
          </div>
        </div>
      </div>
    `

    document.getElementById('btnChangeLoginPwd').onclick = () => {
      const bodyHtml = `
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">当前密码</label>
          <input class="form-input" id="oldPwd" type="password" placeholder="请输入当前密码" style="padding:10px 14px;font-size:14px">
        </div>
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">新密码</label>
          <input class="form-input" id="newPwd" type="password" placeholder="请输入新密码" style="padding:10px 14px;font-size:14px">
        </div>
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">确认新密码</label>
          <input class="form-input" id="confirmPwd" type="password" placeholder="请再次输入新密码" style="padding:10px 14px;font-size:14px">
        </div>
        <button class="btn btn-primary" id="btnConfirmChangePwd" style="margin-top:8px;padding:10px;font-size:14px">确认修改</button>
      `
      const { close } = showModal('修改登录密码', bodyHtml)
      document.getElementById('btnConfirmChangePwd').onclick = async () => {
        const oldPassword = document.getElementById('oldPwd').value
        const newPassword = document.getElementById('newPwd').value
        const confirm = document.getElementById('confirmPwd').value
        if (!oldPassword || !newPassword || !confirm) return showToast('请填写完整')
        if (newPassword !== confirm) return showToast('两次输入的密码不一致')
        if (newPassword.length < 8) return showToast('新密码至少8位')
        try {
          await api('/users/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) })
          close()
          showToast('登录密码已修改', 'success')
        } catch (e) {
          showToast(e.message || '操作失败', 'error')
        }
      }
    }

    document.getElementById('btnChangePayPwd').onclick = () => navigate('resetPayPassword')

    document.getElementById('btnBindPhone').onclick = () => {
      const bodyHtml = `
        ${user.phone ? `<div style="font-size:13px;color:var(--kb-text-secondary);margin-bottom:12px">当前绑定：${user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</div>` : ''}
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">新手机号</label>
          <input class="form-input" id="bindPhoneInput" placeholder="请输入新手机号" maxlength="11" style="padding:10px 14px;font-size:14px">
        </div>
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">验证码</label>
          <div style="display:flex;gap:8px">
            <input class="form-input" id="phoneCode" placeholder="验证码" maxlength="6" style="padding:10px 14px;font-size:14px;flex:1">
            <button class="btn btn-secondary" id="btnSendPhoneCode" style="min-width:100px;padding:10px;font-size:13px;white-space:nowrap">发送验证码</button>
          </div>
        </div>
        <button class="btn btn-primary" id="btnConfirmBindPhone" style="margin-top:8px;padding:10px;font-size:14px">确认绑定</button>
      `
      const { close } = showModal(user.phone ? '换绑手机号' : '绑定手机号', bodyHtml)
      document.getElementById('btnConfirmBindPhone').onclick = async () => {
        const phone = document.getElementById('bindPhoneInput').value.trim()
        const code = document.getElementById('phoneCode').value.trim()
        if (!phone || !code) return showToast('请填写完整')
        try {
          await api('/users/bind-phone', { method: 'POST', body: JSON.stringify({ phone, code }) })
          close()
          showToast('手机号绑定成功', 'success')
          renderSecurity()
        } catch (e) {
          showToast(e.message || '操作失败', 'error')
        }
      }
    }

    document.getElementById('btnBindEmail').onclick = () => {
      const bodyHtml = `
        ${user.email ? `<div style="font-size:13px;color:var(--kb-text-secondary);margin-bottom:12px">当前绑定：${user.email.replace(/(.{2}).+(@.+)/, '$1***$2')}</div>` : ''}
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">新邮箱</label>
          <input class="form-input" id="bindEmailInput" placeholder="请输入新邮箱" style="padding:10px 14px;font-size:14px">
        </div>
        <div class="form-group">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--kb-text-secondary);margin-bottom:4px">验证码</label>
          <div style="display:flex;gap:8px">
            <input class="form-input" id="emailCode" placeholder="验证码" maxlength="6" style="padding:10px 14px;font-size:14px;flex:1">
            <button class="btn btn-secondary" id="btnSendEmailCode" style="min-width:100px;padding:10px;font-size:13px;white-space:nowrap">发送验证码</button>
          </div>
        </div>
        <button class="btn btn-primary" id="btnConfirmBindEmail" style="margin-top:8px;padding:10px;font-size:14px">确认绑定</button>
      `
      const { close } = showModal(user.email ? '换绑邮箱' : '绑定邮箱', bodyHtml)
      document.getElementById('btnConfirmBindEmail').onclick = async () => {
        const email = document.getElementById('bindEmailInput').value.trim()
        const code = document.getElementById('emailCode').value.trim()
        if (!email || !code) return showToast('请填写完整')
        try {
          await api('/users/bind-email', { method: 'POST', body: JSON.stringify({ email, code }) })
          close()
          showToast('邮箱绑定成功', 'success')
          renderSecurity()
        } catch (e) {
          showToast(e.message || '操作失败', 'error')
        }
      }
    }

    try {
      const logs = await api('/users/login-logs')
      const deviceContainer = document.getElementById('deviceList')
      if (logs && logs.length > 0) {
        deviceContainer.innerHTML = logs.slice(0, 10).map(l => `
          <div class="kb-security-item">
            <div class="kb-security-item-icon" style="background:var(--kb-bg);color:var(--kb-text-secondary)">${icon('settings', 18)}</div>
            <div class="kb-security-item-info">
              <div class="kb-name" style="font-size:13px">${l.ip || '未知IP'}</div>
              <div class="kb-desc" style="font-size:11px">${fmtTime(l.createdAt)}${l.success ? '' : ' · 登录失败'}</div>
            </div>
          </div>
        `).join('')
      }
    } catch (e) {
    }
  } catch (e) {
    document.getElementById('securityContent').innerHTML = `<div class="kb-security-card"><div class="kb-security-empty"><div style="font-size:14px;color:var(--kb-danger)">加载失败：${e.message}</div></div></div>`
  }
}

// 商户入驻申请
async function renderMerchantRegister() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-merchant-hero{background:linear-gradient(135deg,#722ed1 0%,#9254de 100%);padding:calc(var(--kb-safe-area-top) + 8px) 20px 80px;color:#fff;position:relative;overflow:hidden}
        .kb-merchant-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,255,255,0.12) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-merchant-hero::after{content:'';position:absolute;bottom:-60px;left:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-merchant-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;position:relative;z-index:1}
        .kb-merchant-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-merchant-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-merchant-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-merchant-header .kb-placeholder{width:32px}
        .kb-merchant-hero-content{text-align:center;position:relative;z-index:1}
        .kb-merchant-hero-icon{width:72px;height:72px;margin:0 auto 16px;background:rgba(255,255,255,0.15);border-radius:20px;display:flex;align-items:center;justify-content:center}
        .kb-merchant-hero-title{font-size:22px;font-weight:700;margin-bottom:6px}
        .kb-merchant-hero-desc{font-size:13px;opacity:0.8}
        .kb-merchant-content{margin:-56px 16px 0;position:relative;z-index:2}
        .kb-merchant-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(114,46,209,0.1)}
        .kb-merchant-notice{font-size:13px;color:var(--kb-text-secondary);line-height:1.6;padding:12px 14px;background:#fff7e6;border:1px solid #ffe58f;border-radius:10px;margin-bottom:20px;display:flex;gap:8px}
        .kb-merchant-notice svg{flex-shrink:0;margin-top:1px}
        .kb-merchant-type-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
        .kb-merchant-type-item{padding:14px;border:2px solid var(--kb-border);border-radius:12px;text-align:center;cursor:pointer;transition:all 0.2s}
        .kb-merchant-type-item.active{border-color:#722ed1;background:#f9f0ff}
        .kb-merchant-type-item .kb-t-name{font-size:14px;font-weight:600;color:var(--kb-text);margin-top:6px}
      </style>

      <div class="kb-merchant-hero">
        <div class="kb-merchant-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">商户入驻</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-merchant-hero-content">
          <div class="kb-merchant-hero-icon">${icon('chart', 36)}</div>
          <div class="kb-merchant-hero-title">成为商户</div>
          <div class="kb-merchant-hero-desc">开通商户收款，享受专业服务</div>
        </div>
      </div>

      <div class="kb-merchant-content">
        <div class="kb-merchant-card">
          <div class="kb-merchant-notice" id="identityNotice">
            ${icon('idCard', 16, '#d48806')}
            <span>需要先登录且完成实名认证才能申请商户入驻。</span>
          </div>

          <div class="form-group">
            <label class="form-label">商户名称</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('user', 18)}</span>
              <input class="form-input" id="merchantName" placeholder="请输入商户名称" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">商户类型</label>
            <select class="form-input" id="merchantType" style="appearance:none;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22></polyline></svg>');background-repeat:no-repeat;background-position:right 14px center;padding-right:36px">
              <option value="INDIVIDUAL">个人商户</option>
              <option value="ENTERPRISE">企业商户</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">联系人姓名</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('user', 18)}</span>
              <input class="form-input" id="contactName" placeholder="请输入联系人姓名" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">联系人手机</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('phone', 18)}</span>
              <input class="form-input" id="contactPhone" placeholder="请输入联系人手机" maxlength="11" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">结算账户</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('bank', 18)}</span>
              <input class="form-input" id="settlementAccount" placeholder="例如：银行卡号或支付宝账号" style="padding-left:42px">
            </div>
          </div>

          <div class="form-group" id="licenseGroup" style="display:none">
            <label class="form-label">营业执照号</label>
            <div style="position:relative">
              <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('idCard', 18)}</span>
              <input class="form-input" id="businessLicense" placeholder="请输入营业执照号" style="padding-left:42px">
            </div>
          </div>

          <button class="btn btn-primary" id="btnSubmit" style="height:50px;font-size:16px;font-weight:600;background:linear-gradient(135deg,#722ed1,#9254de);box-shadow:0 4px 12px rgba(114,46,209,0.3)">提交申请</button>
        </div>
      </div>
    </div>
  `

  const typeSelect = document.getElementById('merchantType')
  const licenseGroup = document.getElementById('licenseGroup')
  typeSelect.onchange = () => {
    licenseGroup.style.display = typeSelect.value === 'ENTERPRISE' ? 'block' : 'none'
  }

  try {
    const user = await api('/users/me')
    if (!user.realName || !user.idCard) {
      document.getElementById('identityNotice').textContent = '您尚未完成实名认证，请先完成实名认证后再申请商户入驻。'
    }
  } catch (e) {
  }

  document.getElementById('btnSubmit').onclick = async () => {
    const body = {
      merchantName: document.getElementById('merchantName').value.trim(),
      merchantType: document.getElementById('merchantType').value,
      contactName: document.getElementById('contactName').value.trim(),
      contactPhone: document.getElementById('contactPhone').value.trim(),
      settleAccount: document.getElementById('settlementAccount').value.trim(),
    }
    if (body.merchantType === 'ENTERPRISE') {
      body.businessLicenseNo = document.getElementById('businessLicense').value.trim()
      if (!body.businessLicenseNo) return showToast('企业商户必须填写营业执照号')
    }
    if (!body.merchantName || !body.contactName || !body.contactPhone || !body.settleAccount) {
      return showToast('请填写完整资料')
    }
    try {
      await api('/merchants/register', { method: 'POST', body: JSON.stringify(body) })
      showToast('商户入驻申请已提交，等待审核', 'success')
      navigate('merchantDashboard')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }
}

// 商户资料/状态页
async function renderMerchantDashboard() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page">
      <style>
        .m-dashboard-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:linear-gradient(135deg,#722ed1 0%,#9254de 100%);color:#fff}
        .m-dashboard-header .m-title{font-size:17px;font-weight:600}
        .m-dashboard-header .m-back{font-size:20px;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .m-stat-row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:12px 16px}
        .m-stat-card{background:#fff;border-radius:12px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .m-stat-card .m-stat-label{font-size:12px;color:var(--kb-text-secondary);margin-bottom:6px}
        .m-stat-card .m-stat-value{font-size:20px;font-weight:700;color:var(--kb-text)}
        .m-stat-card .m-stat-sub{font-size:11px;color:var(--kb-text-tertiary);margin-top:4px}
        .m-chart-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .m-chart-title{font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px}
        .m-chart-bars{display:flex;align-items:flex-end;gap:6px;height:120px;padding-top:8px}
        .m-chart-bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;height:100%}
        .m-chart-bar{width:100%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#722ed1,#b37feb);transition:height 0.4s ease;min-height:2px;position:relative}
        .m-chart-bar:hover{opacity:0.85}
        .m-chart-bar-label{font-size:10px;color:var(--kb-text-tertiary);margin-top:6px;text-align:center}
        .m-chart-bar-value{font-size:9px;color:var(--kb-text-secondary);margin-bottom:4px;text-align:center;white-space:nowrap}
        .m-quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:0 16px;margin-bottom:12px}
        .m-quick-item{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0;background:#fff;border-radius:12px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.06);transition:transform 0.15s}
        .m-quick-item:active{transform:scale(0.96)}
        .m-quick-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}
        .m-quick-label{font-size:12px;color:var(--kb-text);font-weight:500}
        .m-section-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .m-section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
        .m-section-title{font-size:15px;font-weight:600;color:var(--kb-text)}
        .m-order-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--kb-border-light)}
        .m-order-item:last-child{border-bottom:none}
        .m-order-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
        .m-order-info{flex:1;min-width:0}
        .m-order-title{font-size:13px;font-weight:500;color:var(--kb-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .m-order-meta{font-size:11px;color:var(--kb-text-tertiary);margin-top:2px}
        .m-order-right{text-align:right;flex-shrink:0}
        .m-order-amount{font-size:14px;font-weight:600;color:var(--kb-text)}
        .m-order-status{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;margin-top:2px}
        .m-settle-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--kb-border-light)}
        .m-settle-row:last-child{border-bottom:none}
        .m-settle-label{font-size:13px;color:var(--kb-text-secondary)}
        .m-settle-value{font-size:14px;font-weight:600;color:var(--kb-text)}
        .m-settle-value.pending{color:#fa8c16}
        .m-create-form{margin-top:12px}
      </style>

      <div class="m-dashboard-header">
        <button class="m-back" onclick="history.back()" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)">${icon('back', 18)}</button>
        <div class="m-title">商户中心</div>
        <div style="width:32px"></div>
      </div>

      <div id="merchantDashboardContent">
        <div style="padding:32px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>
      </div>
    </div>
  `
  const container = document.getElementById('merchantDashboardContent')
  try {
    const m = await api('/merchants/me')
    const statusMap = { PENDING: '审核中', APPROVED: '已通过', REJECTED: '已拒绝' }
    const statusColorMap = { PENDING: '#fa8c16', APPROVED: '#52c41a', REJECTED: '#f5222d' }

    if (m.status !== 'APPROVED') {
      container.innerHTML = `
        <div class="m-section-card" style="margin-top:12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div style="width:48px;height:48px;border-radius:12px;background:${statusColorMap[m.status]}15;display:flex;align-items:center;justify-content:center">
              <span style="display:inline-flex;align-items:center;color:${statusColorMap[m.status]}">${m.status === 'PENDING' ? icon('lock', 24) : icon('close', 24)}</span>
            </div>
            <div>
              <div style="font-size:16px;font-weight:600;color:var(--kb-text)">${m.merchantName}</div>
              <div style="font-size:13px;color:${statusColorMap[m.status]}">${statusMap[m.status]}</div>
            </div>
          </div>
          <div class="m-settle-row"><span class="m-settle-label">商户号</span><span class="m-settle-value" style="font-size:12px;font-family:monospace">${m.merchantNo}</span></div>
          <div class="m-settle-row"><span class="m-settle-label">商户类型</span><span class="m-settle-value">${m.merchantType === 'ENTERPRISE' ? '企业' : '个人'}</span></div>
          ${m.rejectReason ? `<div style="background:#fff1f0;border:1px solid #ffccc7;color:#cf1322;padding:10px 14px;border-radius:8px;font-size:13px;margin-top:12px">拒绝原因：${m.rejectReason}</div>` : ''}
        </div>
        <div class="m-section-card">
          <div class="m-section-title">修改资料</div>
          <div class="m-create-form">
            <div style="margin-bottom:10px">
              <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">商户名称</label>
              <input class="form-input" id="editName" value="${m.merchantName}">
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">联系人姓名</label>
              <input class="form-input" id="editContactName" value="${m.contactName || ''}">
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">联系人手机</label>
              <input class="form-input" id="editContactPhone" value="${m.contactPhone || ''}">
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">结算账户</label>
              <input class="form-input" id="editSettlementAccount" value="${m.settleAccount || ''}">
            </div>
            ${m.merchantType === 'ENTERPRISE' ? `
              <div style="margin-bottom:10px">
                <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">营业执照号</label>
                <input class="form-input" id="editBusinessLicense" value="${m.businessLicenseNo || ''}">
              </div>
            ` : ''}
            <button class="btn btn-primary" id="btnUpdate" style="width:100%">保存修改</button>
          </div>
        </div>
      `
      document.getElementById('btnUpdate').onclick = async () => {
        const body = {
          merchantName: document.getElementById('editName').value.trim(),
          contactName: document.getElementById('editContactName').value.trim(),
          contactPhone: document.getElementById('editContactPhone').value.trim(),
          settleAccount: document.getElementById('editSettlementAccount').value.trim(),
        }
        if (m.merchantType === 'ENTERPRISE') {
          body.businessLicenseNo = document.getElementById('editBusinessLicense').value.trim()
          if (!body.businessLicenseNo) return showToast('企业商户必须填写营业执照号')
        }
        try {
          await api('/merchants/me', { method: 'PATCH', body: JSON.stringify(body) })
          showToast('资料已更新', 'success')
          navigate('merchantDashboard')
        } catch (e) { showToast(e.message || '操作失败', 'error') }
      }
      return
    }

    let dash = { today: {}, week: {}, month: {} }
    try { dash = await api('/merchants/dashboard') } catch (e) {  }

    const todayAmt = Number(dash.today?.amountYuan || 0)
    const weekAmt = Number(dash.week?.amountYuan || 0)
    const monthAmt = Number(dash.month?.amountYuan || 0)
    const totalAmt = todayAmt + weekAmt + monthAmt

    const statCardsHtml = `
      <div class="m-stat-row">
        <div class="m-stat-card">
          <div class="m-stat-label">今日交易</div>
          <div class="m-stat-value" style="color:#722ed1">¥${fmtMoney(dash.today?.amountYuan)}</div>
          <div class="m-stat-sub">${dash.today?.count || 0} 笔</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">本周交易</div>
          <div class="m-stat-value" style="color:#1677ff">¥${fmtMoney(dash.week?.amountYuan)}</div>
          <div class="m-stat-sub">${dash.week?.count || 0} 笔</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">本月交易</div>
          <div class="m-stat-value" style="color:#52c41a">¥${fmtMoney(dash.month?.amountYuan)}</div>
          <div class="m-stat-sub">${dash.month?.count || 0} 笔</div>
        </div>
        <div class="m-stat-card">
          <div class="m-stat-label">累计交易</div>
          <div class="m-stat-value" style="color:#fa8c16">¥${fmtMoney(totalAmt)}</div>
          <div class="m-stat-sub">${(dash.today?.count || 0) + (dash.week?.count || 0) + (dash.month?.count || 0)} 笔</div>
        </div>
      </div>
    `

    let weeklyData = []
    try {
      const today = new Date()
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const label = `${d.getMonth() + 1}/${d.getDate()}`
        weeklyData.push({ label, amount: 0 })
      }
      const bills = await api('/bills')
      bills.forEach(b => {
        const bd = fmtDate(new Date(b.createdAt))
        const todayStr = fmtDate(new Date())
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          if (fmtDate(d) === bd && b.direction === 'INCOME') {
            weeklyData[6 - i].amount += Number(b.amountYuan || 0)
          }
        }
      })
    } catch (e) { /* use empty data */ }

    const maxAmount = Math.max(...weeklyData.map(d => d.amount), 1)
    const chartHtml = `
      <div class="m-chart-card">
        <div class="m-chart-title">近7日交易趋势</div>
        <div class="m-chart-bars">
          ${weeklyData.map(d => {
            const h = Math.max(2, (d.amount / maxAmount) * 100)
            return `
              <div class="m-chart-bar-wrap">
                <div class="m-chart-bar-value">${d.amount > 0 ? '¥' + fmtMoney(d.amount) : ''}</div>
                <div class="m-chart-bar" style="height:${h}%"></div>
                <div class="m-chart-bar-label">${d.label}</div>
              </div>
            `
          }).join('')}
        </div>
      </div>
    `

    let recentOrdersHtml = ''
    try {
      const bills = (await api('/bills')).slice(0, 5)
      const typeIcons = { RECHARGE: 'recharge', WITHDRAW: 'withdraw', TRANSFER: 'transfer', RECEIPT: 'receipt', PAYMENT: 'payment', REFUND: 'refund', RED_PACKET: 'redpacket' }
      const statusStyles = {
        SUCCESS: { bg: '#f6ffed', color: '#52c41a', label: '成功' },
        PENDING: { bg: '#fff7e6', color: '#fa8c16', label: '处理中' },
        FAILED: { bg: '#fff1f0', color: '#f5222d', label: '失败' },
      }
      if (bills.length > 0) {
        recentOrdersHtml = `
          <div class="m-section-card">
            <div class="m-section-header">
              <div class="m-section-title">最近订单</div>
              <div style="font-size:12px;color:var(--kb-primary);cursor:pointer" onclick="navigate('bills')">查看全部 ${icon('chevronRight', 12)}</div>
            </div>
            ${bills.map(b => {
              const s = statusStyles[b.status] || { bg: '#f5f5f5', color: '#666', label: b.status || '-' }
              return `
                <div class="m-order-item" style="cursor:pointer" onclick="navigate('billDetail?id=${b.id}')">
                  <div class="m-order-icon" style="background:#f5f5f5">${icon(typeIcons[b.type] || 'receipt', 20)}</div>
                  <div class="m-order-info">
                    <div class="m-order-title">${fmtType(b.type)}${b.counterparty ? ' · ' + b.counterparty : ''}</div>
                    <div class="m-order-meta">${fmtTime(b.createdAt)}${b.remark ? ' · ' + b.remark : ''}</div>
                  </div>
                  <div class="m-order-right">
                    <div class="m-order-amount">${b.direction === 'INCOME' ? '+' : '-'}${b.amountYuan}</div>
                    <div class="m-order-status" style="background:${s.bg};color:${s.color}">${s.label}</div>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        `
      }
    } catch (e) { /* skip */ }

    const quickActionsHtml = `
      <div class="m-quick-grid">
        <div class="m-quick-item" onclick="navigate('merchantQrCodes')">
          <div class="m-quick-icon" style="background:#f9f0ff;color:#722ed1">${icon('qrcode',22)}</div>
          <div class="m-quick-label">收款码</div>
        </div>
        <div class="m-quick-item" onclick="navigate('bills')">
          <div class="m-quick-icon" style="background:#e6f7ff;color:#1677ff">${icon('bill',22)}</div>
          <div class="m-quick-label">交易记录</div>
        </div>
        <div class="m-quick-item" onclick="navigate('merchantReconciliation')">
          <div class="m-quick-icon" style="background:#f6ffed;color:#52c41a">${icon('chart',22)}</div>
          <div class="m-quick-label">对账</div>
        </div>
        <div class="m-quick-item" onclick="navigate('merchantApps')">
          <div class="m-quick-icon" style="background:#fff7e6;color:#fa8c16">${icon('settings',22)}</div>
          <div class="m-quick-label">设置</div>
        </div>
      </div>
    `

    const pendingSettlement = Number(dash.today?.netYuan || 0) * 0.3
    const lastSettlement = dash.week?.settledAt ? fmtTime(dash.week.settledAt) : '暂无'
    const settleHtml = `
      <div class="m-section-card">
        <div class="m-section-title">结算信息</div>
        <div class="m-settle-row">
          <span class="m-settle-label">待结算金额</span>
          <span class="m-settle-value pending">¥${fmtMoney(pendingSettlement)}</span>
        </div>
        <div class="m-settle-row">
          <span class="m-settle-label">最近结算</span>
          <span class="m-settle-value">${lastSettlement}</span>
        </div>
        <div class="m-settle-row">
          <span class="m-settle-label">收款费率</span>
          <span class="m-settle-value">${(m.payRate / 100).toFixed(2)}%</span>
        </div>
        <div class="m-settle-row">
          <span class="m-settle-label">日限额</span>
          <span class="m-settle-value">¥${fmtMoney(m.dailyLimitYuan)}</span>
        </div>
      </div>
    `

    container.innerHTML = statCardsHtml + chartHtml + quickActionsHtml + recentOrdersHtml + settleHtml + `
      <div class="m-section-card">
        <div class="m-section-title">创建收款订单</div>
        <div class="m-create-form">
          <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">商户订单号</label>
            <input class="form-input" id="merchantOrderNo" placeholder="请输入商户订单号">
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">金额（元）</label>
            <input class="form-input" id="orderAmount" type="number" placeholder="0.00">
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">商品标题</label>
            <input class="form-input" id="orderTitle" placeholder="请输入商品标题">
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">商品描述</label>
            <input class="form-input" id="orderDescription" placeholder="请输入商品描述">
          </div>
          <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">回调 URL（可选）</label>
            <input class="form-input" id="orderCallbackUrl" placeholder="https://example.com/callback">
          </div>
          <button class="btn btn-primary" id="btnCreateOrder" style="width:100%">创建订单</button>
          <div id="createOrderResult" style="margin-top:12px;display:none"></div>
        </div>
      </div>
    `
    document.getElementById('btnCreateOrder').onclick = async () => {
      const body = {
        merchantOrderNo: document.getElementById('merchantOrderNo').value.trim(),
        amount: Number(document.getElementById('orderAmount').value),
        subject: document.getElementById('orderTitle').value.trim(),
        body: document.getElementById('orderDescription').value.trim(),
        callbackUrl: document.getElementById('orderCallbackUrl').value.trim() || undefined,
      }
      if (!body.merchantOrderNo || !body.subject || isNaN(body.amount) || body.amount <= 0) {
        return showToast('请填写完整的订单信息')
      }
      try {
        const res = await api('/cashier/orders', { method: 'POST', body: JSON.stringify(body) })
        const result = document.getElementById('createOrderResult')
        result.style.display = 'block'
        result.innerHTML = `
          <div style="background:#f6ffed;border:1px solid #b7eb8f;padding:10px 14px;border-radius:8px;font-size:13px;color:#52c41a;margin-bottom:12px">订单创建成功</div>
          <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">收银台链接</label>
            <input class="form-input" id="cashierUrl" value="${res.cashierUrl}" readonly style="font-size:12px">
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" id="btnCopyUrl" style="flex:1">复制链接</button>
            <button class="btn btn-primary" id="btnGoCashier" style="flex:1">去收银台</button>
          </div>
        `
        document.getElementById('btnCopyUrl').onclick = () => {
          navigator.clipboard.writeText(res.cashierUrl).then(() => showToast('已复制', 'success')).catch(() => {
            const el = document.getElementById('cashierUrl')
            el.select(); document.execCommand('copy'); showToast('已复制', 'success')
          })
        }
        document.getElementById('btnGoCashier').onclick = () => { window.location.href = res.cashierUrl }
      } catch (e) { showToast(e.message || '操作失败', 'error') }
    }
  } catch (e) {
    container.innerHTML = `
      <div class="m-section-card" style="margin-top:12px;text-align:center">
        <div style="display:flex;justify-content:center;margin-bottom:12px;opacity:0.4">${icon('chart', 48)}</div>
        <div style="font-size:15px;color:var(--kb-text-secondary);margin-bottom:16px">尚未申请商户入驻</div>
        <button class="btn btn-primary" id="btnGoRegister">去入驻</button>
      </div>
    `
    document.getElementById('btnGoRegister').onclick = () => navigate('merchantRegister')
  }
}

// 商户审核（管理员）
async function renderMerchantAdmin() {
  app.innerHTML = `
    <div class="page">
      <div class="kb-page-header" style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff"><button class="kb-back-btn" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)" onclick="history.back()">${icon('back',18)}</button><h1 style="font-size:17px;font-weight:600;margin:0">商户审核</h1><div style="width:32px"></div></div>
      <div class="tabs">
        <div class="tab active" data-status="">全部</div>
        <div class="tab" data-status="PENDING">待审核</div>
        <div class="tab" data-status="APPROVED">已通过</div>
        <div class="tab" data-status="REJECTED">已拒绝</div>
      </div>
      <div class="card" id="merchantList"></div>
    </div>
  `
  let currentStatus = ''
  const load = async () => {
    const url = currentStatus ? `/admin/merchants?status=${currentStatus}` : '/admin/merchants'
    const res = await adminApi(url)
    const list = res.data || res
    const container = document.getElementById('merchantList')
    const statusMap = { PENDING: '审核中', APPROVED: '已通过', REJECTED: '已拒绝' }
    if (list.length === 0) {
      container.innerHTML = '<div class="empty">暂无商户</div>'
    } else {
      container.innerHTML = list.map((m) => `
        <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div class="bill-type">${m.merchantName}</div>
            <div class="bill-amount">${statusMap[m.status] || m.status}</div>
          </div>
          <div class="bill-time">商户号：${m.merchantNo} · 申请人：${m.contactName || ''} ${m.contactPhone || ''}</div>
          ${m.status === 'PENDING' ? `
            <div style="display:flex;gap:8px;width:100%;margin-top:4px">
              <button class="btn btn-primary" style="flex:1;margin-top:0" onclick="auditMerchant('${m.id}', 'APPROVED')">通过</button>
              <button class="btn btn-secondary" style="flex:1;margin-top:0" onclick="showReject('${m.id}')">拒绝</button>
            </div>
            <div id="reject-${m.id}" style="display:none;width:100%">
              <input class="form-input" id="reason-${m.id}" placeholder="请输入拒绝原因" style="margin-top:8px">
              <button class="btn btn-primary" style="margin-top:8px" onclick="auditMerchant('${m.id}', 'REJECTED')">确认拒绝</button>
            </div>
          ` : ''}
        </div>
      `).join('')
    }
  }

  window.auditMerchant = async (id, status) => {
    const action = status === 'REJECTED' ? 'REJECT' : 'APPROVE'
    const body = { action }
    if (status === 'REJECTED') {
      body.reason = document.getElementById(`reason-${id}`).value.trim()
      if (!body.reason) return showToast('请填写拒绝原因')
    }
    try {
      await adminApi(`/admin/merchants/${id}/audit`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      showToast('审核操作成功', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.showReject = (id) => {
    const el = document.getElementById(`reject-${id}`)
    el.style.display = el.style.display === 'none' ? 'block' : 'none'
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = async () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      currentStatus = tab.getAttribute('data-status')
      await load()
    }
  })

  try {
    await load()
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
}

// 统一收银台
async function renderCashier() {
  const hash = window.location.hash.replace('#', '') || ''
  const params = new URLSearchParams(hash.split('?')[1] || '')
  const orderNo = params.get('orderNo')
  const payMethod = params.get('method') // wechat | alipay | wallet

  if (!token) return navigate('login')

  if (!orderNo) {
    app.innerHTML = `
      <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
        <style>
          .kb-cashier-header{background:#fff;padding:calc(var(--kb-safe-area-top) + 8px) 20px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--kb-border)}
          .kb-cashier-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)}
          .kb-cashier-header .kb-back:active{background:var(--kb-border)}
          .kb-cashier-header .kb-title{font-size:17px;font-weight:600;color:var(--kb-text)}
          .kb-cashier-header .kb-placeholder{width:32px}
          .kb-cashier-content{padding:16px}
          .kb-cashier-card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(15,23,42,0.05)}
        </style>
        <div class="kb-cashier-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">统一收银台</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-cashier-content">
          <div class="kb-cashier-card">
            <div style="font-size:13px;color:var(--kb-text-secondary);line-height:1.6;padding:12px 14px;background:#f6ffed;border:1px solid #b7eb8f;border-radius:10px;margin-bottom:20px;display:flex;gap:8px">${icon('check', 16, '#52c41a')}<span>请输入订单号进行查询与支付。</span></div>
            <div class="form-group">
              <label class="form-label">订单号</label>
              <div style="position:relative">
                <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('receipt', 18)}</span>
                <input class="form-input" id="inputOrderNo" placeholder="请输入订单号" style="padding-left:42px">
              </div>
            </div>
            <button class="btn btn-primary" id="btnGoOrder" style="height:48px;font-size:15px;font-weight:600">查询订单</button>
          </div>
        </div>
      </div>
    `
    document.getElementById('btnGoOrder').onclick = () => {
      const no = document.getElementById('inputOrderNo').value.trim()
      if (!no) return showToast('请输入订单号')
      navigate(`cashier?orderNo=${encodeURIComponent(no)}`)
    }
    return
  }

  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-cashier-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 100px;color:#fff;position:relative;overflow:hidden}
        .kb-cashier-hero::before{content:'';position:absolute;top:-60px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,rgba(255,255,255,0.12) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-cashier-hero::after{content:'';position:absolute;bottom:-80px;left:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-cashier-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;position:relative;z-index:1}
        .kb-cashier-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-cashier-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-cashier-header .kb-title{font-size:17px;font-weight:600;color:#fff;letter-spacing:0.5px}
        .kb-cashier-header .kb-placeholder{width:32px}
        .kb-cashier-amount{text-align:center;position:relative;z-index:1}
        .kb-cashier-amount .kb-label{font-size:13px;opacity:0.8;margin-bottom:8px}
        .kb-cashier-amount .kb-money{font-size:44px;font-weight:800;letter-spacing:-1px;font-variant-numeric:tabular-nums;line-height:1.1}
        .kb-cashier-amount .kb-subject{font-size:14px;opacity:0.85;margin-top:8px}
        .kb-cashier-content{margin:-76px 16px 0;position:relative;z-index:2}
        .kb-cashier-card{background:#fff;border-radius:20px;padding:20px;box-shadow:0 8px 30px rgba(15,23,42,0.12)}
        .kb-cashier-info-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;font-size:14px}
        .kb-cashier-info-row + .kb-cashier-info-row{border-top:1px solid var(--kb-border-light)}
        .kb-cashier-info-row .kb-k{color:var(--kb-text-secondary)}
        .kb-cashier-info-row .kb-v{font-weight:500;color:var(--kb-text);max-width:60%;text-align:right;word-break:break-all}
        .kb-cashier-countdown{display:flex;align-items:center;gap:6px;justify-content:center;padding:10px;margin-top:12px;background:#fff7e6;border-radius:10px;font-size:13px;color:#d46b08}
        .kb-cashier-section-title{font-size:14px;font-weight:600;color:var(--kb-text);margin:20px 0 12px;display:flex;align-items:center;gap:6px}
        .kb-cashier-methods{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        .kb-cashier-method{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;border-radius:14px;border:2px solid var(--kb-border);cursor:pointer;transition:all 0.2s;background:#fff}
        .kb-cashier-method.active{border-color:var(--kb-primary);background:var(--kb-primary-light)}
        .kb-cashier-method:active{transform:scale(0.96)}
        .kb-cashier-method-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center}
        .kb-cashier-method-label{font-size:12px;color:var(--kb-text);font-weight:500}
        .kb-cashier-qr{text-align:center;padding:20px 0}
        .kb-cashier-qr-tip{font-size:14px;color:var(--kb-text-secondary);margin-bottom:14px}
        .kb-cashier-qr-canvas{border-radius:12px;overflow:hidden;display:inline-block;box-shadow:0 2px 12px rgba(15,23,42,0.1)}
        .kb-cashier-qr-amount{font-size:13px;color:var(--kb-text-tertiary);margin-top:10px}
        .kb-cashier-status{text-align:center;padding:12px;margin-top:12px;border-radius:10px;font-size:13px}
        .kb-cashier-status.pending{background:#e6f4ff;color:var(--kb-primary)}
        .kb-cashier-status.failed{background:#fff2f0;color:var(--kb-danger)}
        .kb-cashier-status.success{background:#f6ffed;color:#52c41a}
        .kb-cashier-expired{text-align:center;padding:20px;color:var(--kb-text-secondary);font-size:14px}
      </style>

      <div class="kb-cashier-hero">
        <div class="kb-cashier-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">订单支付</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-cashier-amount">
          <div class="kb-label">支付金额</div>
          <div class="kb-money" id="orderAmount">--</div>
          <div class="kb-subject" id="orderSubject">加载中...</div>
        </div>
      </div>

      <div class="kb-cashier-content">
        <div class="kb-cashier-card" id="orderInfo">
          <div style="text-align:center;padding:40px 0;color:var(--kb-text-tertiary)">
            <div style="margin-bottom:12px;display:flex;justify-content:center;opacity:0.5">${icon('empty', 48)}</div>
            <div style="font-size:14px">加载中...</div>
          </div>
        </div>
      </div>
    </div>
  `

  try {
    const order = await api(`/cashier/orders/${orderNo}`)
    const statusMap = { PENDING: '待支付', PAID: '已支付', CLOSED: '已关闭', EXPIRED: '已过期' }
    document.getElementById('orderAmount').textContent = '¥' + fmtMoney(order.amountYuan)
    document.getElementById('orderSubject').textContent = order.subject || '订单支付'

    const infoRows = `
      <div class="kb-cashier-info-row"><span class="kb-k">商户</span><span class="kb-v">${order.merchant?.merchantName || '-'}</span></div>
      <div class="kb-cashier-info-row"><span class="kb-k">订单号</span><span class="kb-v" style="font-size:12px;font-variant-numeric:tabular-nums">${orderNo}</span></div>
      <div class="kb-cashier-info-row"><span class="kb-k">状态</span><span class="kb-v" style="color:${order.status === 'PENDING' ? 'var(--kb-primary)' : order.status === 'PAID' ? '#52c41a' : 'var(--kb-text-tertiary)'}">${statusMap[order.status] || order.status}</span></div>
    `

    const container = document.getElementById('orderInfo')
    if (order.status === 'PENDING') {
      const expiryMs = order.expiredAt ? new Date(order.expiredAt).getTime() - Date.now() : 0
      const countdownHtml = expiryMs > 0
        ? `<div class="kb-cashier-countdown" id="countdownWrap"><span style="display:inline-flex">${icon('lock', 14, '#d46b08')}</span><span>剩余支付时间：<strong id="countdown">--:--</strong></span></div>`
        : ''

      const selectedMethod = payMethod || 'wallet'
      const payMethodsHtml = `
        <div class="kb-cashier-section-title">${icon('payment', 16, 'var(--kb-primary)')}选择支付方式</div>
        <div class="kb-cashier-methods">
          <div class="kb-cashier-method ${selectedMethod === 'wallet' ? 'active' : ''}" data-method="wallet">
            <div class="kb-cashier-method-icon" style="background:var(--kb-primary-light);color:var(--kb-primary)">${icon('wallet', 22)}</div>
            <div class="kb-cashier-method-label">余额支付</div>
          </div>
          <div class="kb-cashier-method ${selectedMethod === 'wechat' ? 'active' : ''}" data-method="wechat">
            <div class="kb-cashier-method-icon" style="background:#f6ffed;color:#52c41a">${icon('payment', 22)}</div>
            <div class="kb-cashier-method-label">微信支付</div>
          </div>
          <div class="kb-cashier-method ${selectedMethod === 'alipay' ? 'active' : ''}" data-method="alipay">
            <div class="kb-cashier-method-icon" style="background:#e6f4ff;color:var(--kb-primary)">${icon('card', 22)}</div>
            <div class="kb-cashier-method-label">支付宝</div>
          </div>
        </div>
      `

      let actionHtml = ''
      if (selectedMethod === 'wallet') {
        actionHtml = `
          <div style="margin-top:16px">
            <div class="form-group">
              <label class="form-label">支付密码</label>
              <div style="position:relative">
                <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('lock', 18)}</span>
                <input class="form-input" id="payPassword" type="password" placeholder="请输入6位支付密码" maxlength="6" style="padding-left:42px;letter-spacing:6px;text-align:center;font-size:18px">
              </div>
            </div>
            <button class="btn btn-primary" id="btnPay" style="height:50px;font-size:16px;font-weight:600">确认支付 ¥${fmtMoney(order.amountYuan)}</button>
          </div>
        `
      } else {
        actionHtml = `
          <div id="qrSection" class="kb-cashier-qr"></div>
          <div id="payStatus" class="kb-cashier-status pending" style="display:none"></div>
        `
      }

      container.innerHTML = infoRows + countdownHtml + payMethodsHtml + `<div id="payAction">${actionHtml}</div>`

      if (expiryMs > 0) {
        const el = document.getElementById('countdown')
        const tick = () => {
          if (!el) return
          const remain = new Date(order.expiredAt).getTime() - Date.now()
          if (remain <= 0) {
            el.textContent = '已过期'
            const btn = document.getElementById('btnPay')
            if (btn) btn.disabled = true
            return
          }
          const m = Math.floor(remain / 60000)
          const s = Math.floor((remain % 60000) / 1000)
          el.textContent = `${m}:${String(s).padStart(2, '0')}`
        }
        tick()
        const timer = setInterval(tick, 1000)
        window.addEventListener('hashchange', () => clearInterval(timer), { once: true })
      }

      document.querySelectorAll('.kb-cashier-method').forEach(el => {
        el.onclick = () => {
          const method = el.getAttribute('data-method')
          navigate(`cashier?orderNo=${encodeURIComponent(orderNo)}&method=${method}`)
        }
      })

      if (selectedMethod === 'wallet') {
        document.getElementById('btnPay').onclick = async () => {
          const payPassword = document.getElementById('payPassword').value
          if (!payPassword) { showToast('请输入支付密码'); return }
          const btn = document.getElementById('btnPay')
          btn.disabled = true
          btn.textContent = '支付中...'
          try {
            await api(`/cashier/orders/${orderNo}/pay`, { method: 'POST', body: JSON.stringify({ payPassword }) })
            showPaySuccess(orderNo)
          } catch (e) {
            showToast(e.message || '操作失败', 'error')
            btn.disabled = false
            btn.textContent = `确认支付 ¥${fmtMoney(order.amountYuan)}`
          }
        }
      } else {
        initiateExternalPayment(orderNo, order.amountYuan, selectedMethod, order.subject || '订单支付')
      }
    } else {
      container.innerHTML = infoRows + `<div class="kb-cashier-expired">${icon('close', 20, 'var(--kb-text-tertiary)')}<div style="margin-top:8px">该订单已不可支付</div></div>`
    }
  } catch (e) {
    document.getElementById('orderInfo').innerHTML = `<div class="kb-cashier-expired" style="color:var(--kb-danger)">加载失败：${e.message}</div>`
  }
}

async function initiateExternalPayment(orderNo, amountYuan, method, subject) {
  const qrSection = document.getElementById('qrSection')
  const payStatus = document.getElementById('payStatus')
  try {
    const result = await api('/transactions/recharge', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountYuan,
        payPassword: '000000',
        idempotencyKey: `cashier_${orderNo}_${method}`
      })
    })

    if (result.payUrl) {
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      const isWechat = /MicroMessenger/i.test(navigator.userAgent)
      const isAlipay = /AlipayClient/i.test(navigator.userAgent)

      if (method === 'wechat' && (isWechat || isMobile)) {
        window.location.href = result.payUrl
        qrSection.innerHTML = `<div style="text-align:center;padding:20px;color:var(--kb-text-secondary);font-size:14px">${icon('payment', 24, '#52c41a')}<div style="margin-top:8px">正在跳转微信支付...</div></div>`
        return
      }

      if (method === 'alipay' && (isAlipay || isMobile)) {
        window.location.href = result.payUrl
        qrSection.innerHTML = `<div style="text-align:center;padding:20px;color:var(--kb-text-secondary);font-size:14px">${icon('card', 24, 'var(--kb-primary)')}<div style="margin-top:8px">正在跳转支付宝...</div></div>`
        return
      }

      qrSection.innerHTML = `
        <div class="kb-cashier-qr-tip">请使用${method === 'wechat' ? '微信' : '支付宝'}扫码支付</div>
        <div class="kb-cashier-qr-canvas"><canvas id="payQrCanvas" width="200" height="200"></canvas></div>
        <div class="kb-cashier-qr-amount">金额: ¥${fmtMoney(amountYuan)}</div>
      `
      drawSimpleQr('payQrCanvas', result.payUrl)
    } else {
      qrSection.innerHTML = `<div class="kb-cashier-expired" style="color:var(--kb-danger)">支付链接生成失败，请重试</div>`
      return
    }

    payStatus.style.display = 'block'
    payStatus.textContent = '等待支付完成...'
    payStatus.className = 'kb-cashier-status pending'

    let pollCount = 0
    const maxPoll = 120
    const poll = setInterval(async () => {
      pollCount++
      if (pollCount > maxPoll) {
        clearInterval(poll)
        payStatus.textContent = '支付超时，请刷新页面重试'
        payStatus.className = 'kb-cashier-status failed'
        return
      }
      try {
        const o = await api(`/cashier/orders/${orderNo}`)
        if (o.status === 'PAID') {
          clearInterval(poll)
          showPaySuccess(orderNo)
        } else if (o.status === 'CLOSED' || o.status === 'EXPIRED') {
          clearInterval(poll)
          payStatus.textContent = '订单已关闭'
          payStatus.className = 'kb-cashier-status failed'
        }
      } catch { /* ignore */ }
    }, 2500)

    window.addEventListener('hashchange', () => clearInterval(poll), { once: true })
  } catch (e) {
    qrSection.innerHTML = `<div class="kb-cashier-expired" style="color:var(--kb-danger)">支付发起失败: ${e.message}</div>`
  }
}

function showPaySuccess(orderNo) {
  app.innerHTML = `
    <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <style>
        .kb-success-icon{width:80px;height:80px;background:linear-gradient(135deg,#52c41a,#389e0d);border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:24px;box-shadow:0 8px 24px rgba(82,196,26,0.3);animation:kb-success-pop 0.5s cubic-bezier(0.175,0.885,0.32,1.275)}
        @keyframes kb-success-pop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
        .kb-success-title{font-size:24px;font-weight:700;color:var(--kb-text);margin-bottom:8px}
        .kb-success-desc{font-size:14px;color:var(--kb-text-secondary);margin-bottom:32px}
        .kb-success-order{font-size:12px;color:var(--kb-text-tertiary);margin-bottom:24px;font-variant-numeric:tabular-nums;word-break:break-all;max-width:280px;text-align:center}
        .kb-success-btn{width:240px;height:48px;border-radius:24px;border:none;background:var(--kb-primary-gradient);color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 4px 12px rgba(24,144,255,0.3)}
        .kb-success-btn:active{transform:scale(0.97)}
      </style>
      <div class="kb-success-icon">${icon('check', 40)}</div>
      <div class="kb-success-title">支付成功</div>
      <div class="kb-success-desc">订单已完成支付</div>
      <div class="kb-success-order">订单号：${orderNo}</div>
      <button class="kb-success-btn" id="btnBack">返回首页</button>
    </div>
  `
  document.getElementById('btnBack').onclick = () => navigate('home')
}

// 二维码绘制（使用 QRCode 库）
function drawSimpleQr(canvasId, text) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  
  // 检查 QRCode 库是否可用
  if (typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, text, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    }, function (error) {
      if (error) {
        drawPlaceholderQr(canvas, text)
      }
    })
  } else {
    drawPlaceholderQr(canvas, text)
  }
}

function drawPlaceholderQr(canvas, text) {
  const ctx = canvas.getContext('2d')
  const size = 200
  canvas.width = size
  canvas.height = size

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = '#000'
  const cellSize = 5
  const padding = 20
  for (let i = 0; i < 3; i++) {
    const positions = [
      [padding, padding],
      [size - padding - 7 * cellSize, padding],
      [padding, size - padding - 7 * cellSize]
    ]
    const [x, y] = positions[i]
    ctx.fillRect(x, y, 7 * cellSize, 7 * cellSize)
    ctx.fillStyle = '#fff'
    ctx.fillRect(x + cellSize, y + cellSize, 5 * cellSize, 5 * cellSize)
    ctx.fillStyle = '#000'
    ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize)
  }

  const hash = text.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
  for (let row = 0; row < 26; row++) {
    for (let col = 0; col < 26; col++) {
      if ((hash * (row + 1) * (col + 1)) % 3 === 0) {
        ctx.fillRect(padding + col * cellSize, padding + row * cellSize, cellSize, cellSize)
      }
    }
  }

  ctx.fillStyle = '#666'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('请使用手机扫码', size / 2, size - 5)
}

// 商户应用管理
async function renderMerchantApps() {
  if (!token) return navigate('login')
  try {
    await api('/merchants/me')
  } catch (e) {
    app.innerHTML = `
      <div class="page">
        <div class="kb-page-header" style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff"><button class="kb-back-btn" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)" onclick="history.back()">${icon('back',18)}</button><h1 style="font-size:17px;font-weight:600;margin:0">应用管理</h1><div style="width:32px"></div></div>
        <div class="card">
          <div class="notice">您尚未成为商户，请先完成商户入驻。</div>
          <button class="btn btn-primary" id="btnGoRegister">去入驻</button>
        </div>
      </div>
    `
    document.getElementById('btnGoRegister').onclick = () => navigate('merchantRegister')
    return
  }
  app.innerHTML = `
    <div class="page">
      <style>
        .ma-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
        .ma-header .ma-back{font-size:20px;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .ma-header .ma-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .ma-create-card{background:#fff;border-radius:12px;margin:12px 16px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .ma-app-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .ma-app-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
        .ma-app-name{font-size:16px;font-weight:600;color:var(--kb-text)}
        .ma-status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
        .ma-status-dot{width:6px;height:6px;border-radius:50%}
        .ma-field-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--kb-border-light)}
        .ma-field-row:last-child{border-bottom:none}
        .ma-field-label{font-size:12px;color:var(--kb-text-secondary)}
        .ma-field-value{font-size:13px;color:var(--kb-text);font-family:monospace;max-width:55%;text-align:right;word-break:break-all}
        .ma-copy-btn{background:none;border:1px solid var(--kb-border);border-radius:6px;padding:2px 8px;font-size:11px;color:var(--kb-primary);cursor:pointer;margin-left:6px}
        .ma-copy-btn:active{background:var(--kb-primary-light)}
        .ma-test-card{background:#f6ffed;border:1px solid #b7eb8f;border-radius:12px;margin:0 16px 12px;padding:16px}
        .ma-test-title{font-size:14px;font-weight:600;color:#52c41a;margin-bottom:10px}
        .ma-actions{display:flex;gap:8px;margin-top:12px}
        .ma-actions .btn{flex:1}
        .ma-usage-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .ma-usage-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--kb-border-light)}
        .ma-usage-row:last-child{border-bottom:none}
        .ma-settings-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
      </style>

      <div class="ma-header">
        <button class="ma-back" onclick="history.back()" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)">${icon('back', 18)}</button>
        <div class="ma-title">应用管理</div>
        <div style="width:32px"></div>
      </div>

      <div class="ma-create-card">
        <div style="font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px">创建新应用</div>
        <div style="margin-bottom:10px">
          <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">应用名称</label>
          <input class="form-input" id="appName" placeholder="请输入应用名称">
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">回调 URL</label>
          <input class="form-input" id="appCallbackUrl" placeholder="https://example.com/callback">
        </div>
        <button class="btn btn-primary" id="btnCreateApp" style="width:100%">创建应用</button>
      </div>

      <div id="appListContainer">
        <div style="padding:32px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>
      </div>
    </div>
  `

  const statusConfig = {
    ACTIVE: { label: '启用', bg: '#f6ffed', color: '#52c41a', dot: '#52c41a' },
    INACTIVE: { label: '停用', bg: '#fff1f0', color: '#f5222d', dot: '#f5222d' },
  }

  const load = async () => {
    try {
      const apps = await api('/merchants/apps')
      const container = document.getElementById('appListContainer')
      if (apps.length === 0) {
        container.innerHTML = `
          <div style="padding:48px 16px;text-align:center">
            <div style="display:flex;justify-content:center;margin-bottom:12px;opacity:0.4">${icon('lock', 48)}</div>
            <div style="font-size:15px;color:var(--kb-text-secondary)">暂无应用</div>
            <div style="font-size:13px;color:var(--kb-text-tertiary);margin-top:4px">创建应用以获取 API 密钥</div>
          </div>
        `
        return
      }

      container.innerHTML = apps.map((a, idx) => {
        const sc = statusConfig[a.status] || { label: a.status, bg: '#f5f5f5', color: '#666', dot: '#666' }
        const appIdShort = a.appId ? a.appId.slice(0, 8) + '...' : '-'
        return `
          <div class="ma-app-card">
            <div class="ma-app-header">
              <div>
                <div class="ma-app-name">${a.name || '未命名应用'}</div>
                <div style="font-size:12px;color:var(--kb-text-tertiary);margin-top:2px">AppID: ${appIdShort}</div>
              </div>
              <div class="ma-status-badge" style="background:${sc.bg};color:${sc.color}">
                <span class="ma-status-dot" style="background:${sc.dot}"></span>
                ${sc.label}
              </div>
            </div>

            <div class="ma-field-row">
              <span class="ma-field-label">AppID</span>
              <div style="display:flex;align-items:center">
                <span class="ma-field-value" id="appid-${idx}">${a.appId || '-'}</span>
                <button class="ma-copy-btn" onclick="navigator.clipboard.writeText('${a.appId}').then(()=>showToast('已复制', 'success'))">复制</button>
              </div>
            </div>

            ${a.appSecret ? `
              <div class="ma-field-row">
                <span class="ma-field-label">AppSecret</span>
                <div style="display:flex;align-items:center">
                  <span class="ma-field-value" id="secret-${idx}" style="color:#f5222d">${a.appSecret}</span>
                  <button class="ma-copy-btn" onclick="navigator.clipboard.writeText('${a.appSecret}').then(()=>showToast('已复制', 'success'))">复制</button>
                </div>
              </div>
            ` : `
              <div class="ma-field-row">
                <span class="ma-field-label">AppSecret</span>
                <div style="display:flex;align-items:center">
                  <span class="ma-field-value" style="color:var(--kb-text-tertiary)">请重置密钥查看</span>
                </div>
              </div>
            `}

            <div class="ma-field-row">
              <span class="ma-field-label">回调 URL</span>
              <span class="ma-field-value" style="font-family:inherit;font-size:12px">${a.callbackUrl || '未设置'}</span>
            </div>

            <div class="ma-actions">
              <button class="btn btn-secondary" style="margin-top:0;font-size:12px;padding:6px 12px" onclick="testApiKey('${a.appId}')">测试接口</button>
              <button class="btn btn-secondary" style="margin-top:0;font-size:12px;padding:6px 12px" onclick="editAppSettings('${a.appId}', '${a.name || ''}', '${a.callbackUrl || ''}')">设置</button>
              <button class="btn btn-primary" style="margin-top:0;font-size:12px;padding:6px 12px" onclick="regenerateAppSecret('${a.appId}')">重置密钥</button>
            </div>

            <div class="ma-usage-card" style="margin:12px -16px -16px;border-radius:0 0 12px 12px;border-top:1px solid var(--kb-border-light)">
              <div style="font-size:12px;font-weight:600;color:var(--kb-text);margin-bottom:6px">使用统计</div>
              <div class="ma-usage-row">
                <span class="ma-field-label">今日调用</span>
                <span style="font-size:13px;color:var(--kb-text)">${a.todayCalls || 0} 次</span>
              </div>
              <div class="ma-usage-row">
                <span class="ma-field-label">今日成功</span>
                <span style="font-size:13px;color:#52c41a">${a.todaySuccess || 0} 次</span>
              </div>
              <div class="ma-usage-row">
                <span class="ma-field-label">今日失败</span>
                <span style="font-size:13px;color:#f5222d">${a.todayFail || 0} 次</span>
              </div>
            </div>
          </div>
        `
      }).join('')
    } catch (e) {
      document.getElementById('appListContainer').innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
    }
  }

  window.regenerateAppSecret = async (appId) => {
    if (!confirm('确定要重置该应用的密钥吗？重置后旧密钥将立即失效。')) return
    try {
      const res = await api(`/merchants/apps/${appId}/regenerate-secret`, { method: 'POST' })
      if (res.appSecret) {
        showModal('新密钥已生成', `
          <div style="background:#fff7e6;border:1px solid #ffd591;padding:12px;border-radius:8px;margin-bottom:12px">
            <div style="font-size:13px;color:#874d00;margin-bottom:6px">请立即保存新密钥，关闭后不再显示：</div>
            <div style="font-family:monospace;font-size:14px;font-weight:600;color:#fa8c16;word-break:break-all">${res.appSecret}</div>
          </div>
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${res.appSecret}').then(()=>showToast('已复制', 'success'))" style="width:100%">复制密钥</button>
        `)
      } else {
        showToast('密钥已重置', 'success')
      }
      await load()
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  window.testApiKey = (appId) => {
    showModal('API 测试', `
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">AppID</label>
        <input class="form-input" id="testAppId" value="${appId}" readonly style="font-size:12px;font-family:monospace">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">测试金额（元）</label>
        <input class="form-input" id="testAmount" type="number" placeholder="0.01" value="0.01">
      </div>
      <button class="btn btn-primary" id="btnRunTest" style="width:100%">发送测试请求</button>
      <div id="testResult" style="margin-top:12px;display:none"></div>
    `)
    document.getElementById('btnRunTest').onclick = async () => {
      const amount = Number(document.getElementById('testAmount').value) || 0.01
      const resultEl = document.getElementById('testResult')
      resultEl.style.display = 'block'
      resultEl.innerHTML = '<div style="color:var(--kb-text-secondary);font-size:13px">发送中...</div>'
      try {
        const testBody = {
          merchantOrderNo: `TEST_${Date.now()}`,
          amount: amount,
          subject: 'API测试订单',
          body: '由应用管理页面发起的测试请求',
        }
        const res = await api('/cashier/orders', { method: 'POST', body: JSON.stringify(testBody) })
        resultEl.innerHTML = `
          <div style="background:#f6ffed;border:1px solid #b7eb8f;padding:10px;border-radius:8px;font-size:13px;color:#52c41a">
            测试成功！订单号: ${res.orderNo || res.id || '-'}
          </div>
        `
      } catch (e) {
        resultEl.innerHTML = `
          <div style="background:#fff1f0;border:1px solid #ffccc7;padding:10px;border-radius:8px;font-size:13px;color:#cf1322">
            测试失败: ${e.message}
          </div>
        `
      }
    }
  }

  window.editAppSettings = (appId, name, callbackUrl) => {
    showModal('应用设置', `
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">应用名称</label>
        <input class="form-input" id="editAppName" value="${name}">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">回调 URL</label>
        <input class="form-input" id="editAppCallback" value="${callbackUrl}" placeholder="https://example.com/callback">
      </div>
      <button class="btn btn-primary" id="btnSaveAppSettings" style="width:100%">保存设置</button>
    `)
    document.getElementById('btnSaveAppSettings').onclick = async () => {
      try {
        await api(`/merchants/apps/${appId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: document.getElementById('editAppName').value.trim(),
            callbackUrl: document.getElementById('editAppCallback').value.trim() || undefined,
          }),
        })
        showToast('设置已保存', 'success')
        document.querySelector('.modal-overlay')?.remove()
        await load()
      } catch (e) { showToast(e.message || '操作失败', 'error') }
    }
  }

  document.getElementById('btnCreateApp').onclick = async () => {
    const body = {
      name: document.getElementById('appName').value.trim(),
      callbackUrl: document.getElementById('appCallbackUrl').value.trim() || undefined,
    }
    if (!body.name) return showToast('请输入应用名称')
    try {
      const res = await api('/merchants/apps', { method: 'POST', body: JSON.stringify(body) })
      document.getElementById('appName').value = ''
      document.getElementById('appCallbackUrl').value = ''
      if (res.appSecret) {
        showModal('应用创建成功', `
          <div style="background:#f6ffed;border:1px solid #b7eb8f;padding:12px;border-radius:8px;margin-bottom:12px">
            <div style="font-size:13px;color:#52c41a;margin-bottom:6px">请立即保存您的 AppSecret：</div>
            <div style="font-family:monospace;font-size:14px;font-weight:600;color:#fa8c16;word-break:break-all">${res.appSecret}</div>
          </div>
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${res.appSecret}').then(()=>showToast('已复制', 'success'))" style="width:100%">复制密钥</button>
        `)
      } else {
        showToast('应用创建成功', 'success')
      }
      await load()
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  try { await load() } catch (e) {
    document.getElementById('appListContainer').innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
  }
}

// 商户收款码管理
async function renderMerchantQrCodes() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page">
      <style>
        .mq-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
        .mq-header .mq-back{font-size:20px;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .mq-header .mq-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .mq-create-card{background:#fff;border-radius:12px;margin:12px 16px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .mq-qr-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .mq-qr-display{background:#f9f9f9;border:2px dashed var(--kb-border);border-radius:12px;padding:20px;text-align:center;margin-bottom:12px;position:relative}
        .mq-qr-code{font-size:20px;font-weight:700;color:var(--kb-text);font-family:monospace;letter-spacing:1px}
        .mq-qr-amount{font-size:24px;font-weight:700;color:#722ed1;margin-top:8px}
        .mq-qr-remark{font-size:12px;color:var(--kb-text-secondary);margin-top:4px}
        .mq-field-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--kb-border-light)}
        .mq-field-row:last-child{border-bottom:none}
        .mq-field-label{font-size:12px;color:var(--kb-text-secondary)}
        .mq-field-value{font-size:13px;color:var(--kb-text)}
        .mq-status-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
        .mq-actions{display:flex;gap:8px;margin-top:12px}
        .mq-actions .btn{flex:1;font-size:12px;padding:6px 10px}
        .mq-history-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .mq-history-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--kb-border-light)}
        .mq-history-item:last-child{border-bottom:none}
        .mq-history-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
        .mq-history-info{flex:1;min-width:0}
        .mq-history-code{font-size:13px;font-weight:500;color:var(--kb-text);font-family:monospace}
        .mq-history-meta{font-size:11px;color:var(--kb-text-tertiary);margin-top:2px}
        .mq-share-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .mq-share-card{background:#fff;border-radius:16px;padding:24px;max-width:320px;width:100%;text-align:center}
      </style>

      <div class="mq-header">
        <button class="mq-back" onclick="history.back()" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)">${icon('back', 18)}</button>
        <div class="mq-title">收款码管理</div>
        <div style="width:32px"></div>
      </div>

      <div class="mq-create-card">
        <div style="font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px">生成收款码</div>
        <div style="margin-bottom:10px">
          <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">固定金额（元）</label>
          <input class="form-input" id="qrAmount" type="number" placeholder="0.00（留空为任意金额）">
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">备注</label>
          <input class="form-input" id="qrRemark" placeholder="例如：餐费、商品款">
        </div>
        <button class="btn btn-primary" id="btnCreateQr" style="width:100%">生成收款码</button>
      </div>

      <div id="qrListContainer">
        <div style="padding:32px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>
      </div>
    </div>
  `

  const statusConfig = {
    ACTIVE: { label: '启用', bg: '#f6ffed', color: '#52c41a' },
    DISABLED: { label: '停用', bg: '#fff7e6', color: '#fa8c16' },
    DELETED: { label: '已删除', bg: '#f5f5f5', color: '#999' },
  }

  const load = async () => {
    try {
      const list = await api('/merchants/qrcodes')
      const container = document.getElementById('qrListContainer')
      if (list.length === 0) {
        container.innerHTML = `
          <div style="padding:48px 16px;text-align:center">
            <div style="display:flex;justify-content:center;margin-bottom:12px;opacity:0.4">${icon('receipt',48)}</div>
            <div style="font-size:15px;color:var(--kb-text-secondary)">暂无收款码</div>
            <div style="font-size:13px;color:var(--kb-text-tertiary);margin-top:4px">创建收款码以开始收款</div>
          </div>
        `
        return
      }

      container.innerHTML = list.map((q) => {
        const sc = statusConfig[q.status] || { label: q.status, bg: '#f5f5f5', color: '#666' }
        return `
          <div class="mq-qr-card">
            <div class="mq-qr-display">
              <div class="mq-qr-code">${q.code}</div>
              ${q.amountYuan ? `<div class="mq-qr-amount">¥${fmtMoney(q.amountYuan)}</div>` : '<div class="mq-qr-amount" style="color:var(--kb-text-secondary);font-size:16px">任意金额</div>'}
              ${q.remark ? `<div class="mq-qr-remark">${q.remark}</div>` : ''}
            </div>

            <div class="mq-field-row">
              <span class="mq-field-label">收款码</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="mq-field-value" style="font-family:monospace;font-size:12px">${q.code}</span>
                <button class="ma-copy-btn" onclick="navigator.clipboard.writeText('${q.code}').then(()=>showToast('已复制', 'success'))">复制</button>
              </div>
            </div>

            <div class="mq-field-row">
              <span class="mq-field-label">状态</span>
              <span class="mq-status-badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span>
            </div>

            <div class="mq-field-row">
              <span class="mq-field-label">创建时间</span>
              <span class="mq-field-value" style="font-size:12px">${fmtTime(q.createdAt)}</span>
            </div>

            <div class="mq-actions">
              <button class="btn btn-secondary" onclick="shareQrCode('${q.code}', ${q.amountYuan || 0}, '${q.remark || ''}')">分享</button>
              <button class="btn btn-secondary" onclick="downloadQrCode('${q.code}')">下载</button>
              <button class="btn btn-primary" onclick="deleteQrCode('${q.id}')">删除</button>
            </div>
          </div>
        `
      }).join('')
    } catch (e) {
      document.getElementById('qrListContainer').innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
    }
  }

  window.shareQrCode = (code, amount, remark) => {
    const overlay = document.createElement('div')
    overlay.className = 'mq-share-overlay'
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    overlay.innerHTML = `
      <div class="mq-share-card">
        <div style="font-size:16px;font-weight:600;color:var(--kb-text);margin-bottom:16px">分享收款码</div>
        <div style="background:#f9f9f9;border:2px dashed var(--kb-border);border-radius:12px;padding:20px;margin-bottom:16px">
          <div style="font-size:18px;font-weight:700;color:var(--kb-text);font-family:monospace">${code}</div>
          ${amount ? `<div style="font-size:22px;font-weight:700;color:#722ed1;margin-top:8px">¥${fmtMoney(amount)}</div>` : '<div style="font-size:14px;color:var(--kb-text-secondary);margin-top:8px">任意金额</div>'}
          ${remark ? `<div style="font-size:12px;color:var(--kb-text-secondary);margin-top:4px">${remark}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" style="flex:1" onclick="navigator.clipboard.writeText('收款码: ${code}${amount ? ' 金额: ¥' + fmtMoney(amount) : ''}${remark ? ' 备注: ' + remark : ''}').then(()=>{showToast('已复制', 'success');this.closest('.mq-share-overlay').remove()})">复制文本</button>
          <button class="btn btn-primary" style="flex:1" onclick="navigator.share({title:'收款码',text:'收款码: ${code}${amount ? ' 金额: ¥' + fmtMoney(amount) : ''}'}).catch(()=>{});this.closest('.mq-share-overlay').remove()">发送</button>
        </div>
        <button class="btn btn-text" style="width:100%;margin-top:8px;color:var(--kb-text-secondary)" onclick="this.closest('.mq-share-overlay').remove()">关闭</button>
      </div>
    `
    document.body.appendChild(overlay)
  }

  window.downloadQrCode = (code) => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 380
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 300, 380)

    ctx.fillStyle = '#722ed1'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('科佰支付', 150, 30)

    ctx.strokeStyle = '#722ed1'
    ctx.lineWidth = 2
    ctx.strokeRect(50, 50, 200, 200)

    ctx.fillStyle = '#333'
    ctx.font = 'bold 16px monospace'
    ctx.fillText(code, 150, 160)

    ctx.fillStyle = '#999'
    ctx.font = '12px sans-serif'
    ctx.fillText('请使用科佰支付扫码', 150, 280)

    ctx.fillStyle = '#666'
    ctx.font = '11px sans-serif'
    ctx.fillText(`收款码: ${code}`, 150, 320)

    const link = document.createElement('a')
    link.download = `qrcode_${code}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  window.deleteQrCode = async (id) => {
    if (!confirm('确定删除该收款码吗？删除后不可恢复。')) return
    try {
      await api(`/merchants/qrcodes/${id}`, { method: 'DELETE' })
      showToast('已删除', 'success')
      await load()
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  document.getElementById('btnCreateQr').onclick = async () => {
    const amountVal = document.getElementById('qrAmount').value
    const amount = amountVal ? Number(amountVal) : 0
    const remark = document.getElementById('qrRemark').value.trim()
    if (amount && amount <= 0) return showToast('请输入有效金额')
    try {
      const res = await api('/merchants/qrcodes', { method: 'POST', body: JSON.stringify({ amount: amount || undefined, remark: remark || undefined }) })
      document.getElementById('qrAmount').value = ''
      document.getElementById('qrRemark').value = ''

      if (res.code) {
        showModal('收款码已生成', `
          <div style="background:#f9f9f9;border:2px dashed var(--kb-border);border-radius:12px;padding:20px;text-align:center;margin-bottom:12px">
            <div style="font-size:18px;font-weight:700;color:var(--kb-text);font-family:monospace">${res.code}</div>
            ${res.amountYuan ? `<div style="font-size:22px;font-weight:700;color:#722ed1;margin-top:8px">¥${fmtMoney(res.amountYuan)}</div>` : '<div style="font-size:14px;color:var(--kb-text-secondary);margin-top:8px">任意金额</div>'}
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" style="flex:1" onclick="navigator.clipboard.writeText('${res.code}').then(()=>showToast('已复制', 'success'))">复制</button>
            <button class="btn btn-primary" style="flex:1" onclick="shareQrCode('${res.code}', ${res.amountYuan || 0}, '${remark || ''}')">分享</button>
          </div>
        `)
      } else {
        showToast('收款码生成成功', 'success')
      }
      await load()
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  await load()
}

// 商户对账
async function renderMerchantReconciliation() {
  if (!token) return navigate('login')
  const today = fmtDate(new Date())
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 6)
  const defaultStart = fmtDate(weekAgo)
  app.innerHTML = `
    <div class="page">
      <div class="kb-page-header" style="display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff"><button class="kb-back-btn" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)" onclick="history.back()">${icon('back',18)}</button><h1 style="font-size:17px;font-weight:600;margin:0">商户对账</h1><div style="width:32px"></div></div>
      <div class="card">
        <div class="section-title">日期筛选</div>
        <div class="form-group">
          <label class="form-label">开始日期</label>
          <input class="form-input" type="date" id="reconStart" value="${defaultStart}">
        </div>
        <div class="form-group">
          <label class="form-label">结束日期</label>
          <input class="form-input" type="date" id="reconEnd" value="${today}">
        </div>
        <button class="btn btn-primary" id="btnReconQuery">查询</button>
        <button class="btn btn-secondary" id="btnReconExport" style="margin-top:12px">导出 CSV</button>
      </div>
      <div class="card" id="reconSummary"><div class="empty">请查询</div></div>
      <div class="card" id="reconList"><div class="empty">请查询</div></div>
    </div>
  `
  const load = async () => {
    const startDate = document.getElementById('reconStart').value
    const endDate = document.getElementById('reconEnd').value
    if (!startDate || !endDate) return showToast('请选择日期')
    try {
      const res = await api(`/cashier/orders/reconciliation?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
      const summary = res.summary || {}
      const data = res.data || []
      document.getElementById('reconSummary').innerHTML = `
        <div class="section-title">汇总</div>
        <div class="bill-item"><div class="bill-info"><div class="bill-type">笔数</div></div><div class="bill-amount">${summary.count || 0}</div></div>
        <div class="bill-item"><div class="bill-info"><div class="bill-type">总金额</div></div><div class="bill-amount">¥${fmtMoney(summary.amountYuan)}</div></div>
        <div class="bill-item"><div class="bill-info"><div class="bill-type">手续费</div></div><div class="bill-amount">¥${fmtMoney(summary.feeYuan)}</div></div>
        <div class="bill-item"><div class="bill-info"><div class="bill-type">净收入</div></div><div class="bill-amount income">¥${fmtMoney(summary.netYuan)}</div></div>
      `
      const listEl = document.getElementById('reconList')
      if (data.length === 0) {
        listEl.innerHTML = '<div class="empty">暂无明细</div>'
      } else {
        listEl.innerHTML = `
          <div class="section-title">每日明细</div>
          ${data.map((d) => `
            <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
              <div style="display:flex;justify-content:space-between;width:100%">
                <div class="bill-type">${d.date}</div>
                <div class="bill-amount">${d.count || 0} 笔</div>
              </div>
              <div class="bill-time">金额 ¥${fmtMoney(d.amountYuan)} · 手续费 ¥${fmtMoney(d.feeYuan)} · 净收入 ¥${fmtMoney(d.netYuan)}</div>
            </div>
          `).join('')}
        `
      }
    } catch (e) {
      document.getElementById('reconSummary').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
      document.getElementById('reconList').innerHTML = ''
    }
  }
  document.getElementById('btnReconQuery').onclick = load
  document.getElementById('btnReconExport').onclick = () => {
    const startDate = document.getElementById('reconStart').value
    const endDate = document.getElementById('reconEnd').value
    if (!startDate || !endDate) return showToast('请选择日期')
    downloadCsv(`/cashier/orders/export?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&status=PAID`)
  }
  await load()
}

// 管理后台通用顶部导航
function renderAdminNav(active) {
  const items = [
    { key: 'adminDashboard', label: '仪表盘' },
    { key: 'adminUsers', label: '用户管理' },
    { key: 'adminIdentity', label: '实名审核' },
    { key: 'adminMerchants', label: '商户审核' },
    { key: 'adminWithdrawals', label: '提现审核' },
    { key: 'adminOrders', label: '支付订单' },
    { key: 'adminFinance', label: '财务报表' },
    { key: 'adminReconciliation', label: '对账中心' },
    { key: 'adminRiskEvents', label: '风险事件' },
    { key: 'adminRiskRules', label: '风控规则' },
    { key: 'adminLoginLogs', label: '登录日志' },
    { key: 'adminAuditLogs', label: '审计日志' },
    { key: 'adminConfigs', label: '系统配置' },
    { key: 'adminChannels', label: '支付渠道' },
  ]
  return `
    <div class="header">
      <h1>管理后台</h1>
      <a href="#home" class="link">返回首页</a>
    </div>
    <div class="tabs" style="flex-wrap:wrap">
      ${items.map((item) => `
        <div class="tab ${item.key === active ? 'active' : ''}" data-go="${item.key}">${item.label}</div>
      `).join('')}
    </div>
  `
}

function bindAdminNav() {
  document.querySelectorAll('[data-go]').forEach((el) => {
    el.onclick = () => navigate(el.getAttribute('data-go'))
  })
}

// 管理员登录
function renderAdminLogin() {
  app.innerHTML = `
    <div class="page">
      <div class="header"><h1>管理员登录</h1><a href="#home" class="link">返回</a></div>
      <div class="card">
        <div class="notice" style="background:#fff7e6;border-color:#ffd591;color:#874d00">
          此页面仅限管理员使用，普通用户请返回首页登录
        </div>
        <div class="form-group">
          <label class="form-label">管理员用户名</label>
          <input class="form-input" id="username" placeholder="请输入管理员用户名">
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <input class="form-input" id="password" type="password" placeholder="请输入登录密码">
        </div>
        <button class="btn btn-primary" id="btnAdminLogin">登录</button>
        <div style="text-align:center;margin-top:16px;font-size:13px;color:#999">
          普通用户请返回 <a href="#login" style="color:#1677ff">用户登录</a>
        </div>
      </div>
    </div>
  `
  document.getElementById('btnAdminLogin').onclick = async () => {
    const username = document.getElementById('username').value.trim()
    const password = document.getElementById('password').value
    if (!username || !password) return showToast('请填写用户名和密码')
    try {
      const res = await adminApi('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      localStorage.setItem('adminToken', res.token)
      navigate('adminDashboard')
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }
}

// 管理后台仪表盘
async function renderAdminDashboard() {
  app.innerHTML = `
    <div class="page">
      <style>
        .ad-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:linear-gradient(135deg,#1677ff 0%,#4096ff 100%);color:#fff}
        .ad-header .ad-title{font-size:17px;font-weight:600}
        .ad-header .ad-back{font-size:20px;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .ad-stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:12px 16px}
        .ad-stat-card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06);position:relative;overflow:hidden}
        .ad-stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
        .ad-stat-card.blue::before{background:#1677ff}
        .ad-stat-card.green::before{background:#52c41a}
        .ad-stat-card.orange::before{background:#fa8c16}
        .ad-stat-card.purple::before{background:#722ed1}
        .ad-stat-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:10px}
        .ad-stat-value{font-size:22px;font-weight:700;color:var(--kb-text);margin-bottom:2px}
        .ad-stat-label{font-size:12px;color:var(--kb-text-secondary)}
        .ad-quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:0 16px;margin-bottom:12px}
        .ad-quick-item{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0;background:#fff;border-radius:12px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.06);transition:transform 0.15s}
        .ad-quick-item:active{transform:scale(0.96)}
        .ad-quick-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px}
        .ad-quick-label{font-size:11px;color:var(--kb-text);font-weight:500}
        .ad-status-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .ad-status-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--kb-border-light)}
        .ad-status-row:last-child{border-bottom:none}
        .ad-status-left{display:flex;align-items:center;gap:8px}
        .ad-status-dot{width:8px;height:8px;border-radius:50%}
        .ad-status-label{font-size:13px;color:var(--kb-text)}
        .ad-status-value{font-size:13px;color:var(--kb-text-secondary)}
        .ad-tabs{display:flex;padding:0 16px;margin-bottom:12px;gap:8px;overflow-x:auto}
        .ad-tab{padding:8px 16px;border-radius:20px;font-size:13px;background:#fff;color:var(--kb-text-secondary);cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
        .ad-tab.active{background:var(--kb-primary);color:#fff}
      </style>

      <div class="ad-header">
        <div class="ad-back" onclick="history.back()">‹</div>
        <div class="ad-title">管理后台</div>
        <div style="width:32px"></div>
      </div>

      ${renderAdminNav('adminDashboard')}

      <div id="adminDashContent">
        <div style="padding:32px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>
      </div>
    </div>
  `
  bindAdminNav()
  const container = document.getElementById('adminDashContent')

  try {
    const stats = await adminApi('/admin/dashboard')

    const statCardsHtml = `
      <div class="ad-stat-grid">
        <div class="ad-stat-card blue">
          <div class="ad-stat-icon" style="background:#e6f7ff;color:#1677ff">👥</div>
          <div class="ad-stat-value">${stats.totalUsers || 0}</div>
          <div class="ad-stat-label">用户总数</div>
        </div>
        <div class="ad-stat-card green">
          <div class="ad-stat-icon" style="background:#f6ffed;color:#52c41a">🏪</div>
          <div class="ad-stat-value">${stats.totalMerchants || 0}</div>
          <div class="ad-stat-label">商户总数</div>
        </div>
        <div class="ad-stat-card orange">
          <div class="ad-stat-icon" style="background:#fff7e6;color:#fa8c16">📋</div>
          <div class="ad-stat-value">${stats.todayOrders || 0}</div>
          <div class="ad-stat-label">今日交易</div>
        </div>
        <div class="ad-stat-card purple">
          <div class="ad-stat-icon" style="background:#f9f0ff;color:#722ed1">⏳</div>
          <div class="ad-stat-value">${(stats.pendingWithdrawals || 0) + (stats.pendingMerchants || 0)}</div>
          <div class="ad-stat-label">待审核</div>
        </div>
      </div>
    `

    const quickLinksHtml = `
      <div class="ad-quick-grid">
        <div class="ad-quick-item" onclick="navigate('adminUsers')">
          <div class="ad-quick-icon" style="background:#e6f7ff;color:#1677ff">👥</div>
          <div class="ad-quick-label">用户管理</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminMerchants')">
          <div class="ad-quick-icon" style="background:#f6ffed;color:#52c41a">🏪</div>
          <div class="ad-quick-label">商户审核</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminWithdrawals')">
          <div class="ad-quick-icon" style="background:#fff7e6;color:#fa8c16">💸</div>
          <div class="ad-quick-label">提现审核</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminOrders')">
          <div class="ad-quick-icon" style="background:#f9f0ff;color:#722ed1">📋</div>
          <div class="ad-quick-label">支付订单</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminFinance')">
          <div class="ad-quick-icon" style="background:#fff1f0;color:#f5222d">💰</div>
          <div class="ad-quick-label">财务报表</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminReconciliation')">
          <div class="ad-quick-icon" style="background:#e6fffb;color:#13c2c2">📊</div>
          <div class="ad-quick-label">对账中心</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminRiskEvents')">
          <div class="ad-quick-icon" style="background:#fff1f0;color:#f5222d">⚠️</div>
          <div class="ad-quick-label">风险事件</div>
        </div>
        <div class="ad-quick-item" onclick="navigate('adminConfigs')">
          <div class="ad-quick-icon" style="background:#f5f5f5;color:#666">⚙</div>
          <div class="ad-quick-label">系统配置</div>
        </div>
      </div>
    `

    const pendingItems = []
    if (stats.pendingWithdrawals > 0) pendingItems.push({ label: '待审核提现', value: stats.pendingWithdrawals, color: '#fa8c16' })
    if (stats.pendingMerchants > 0) pendingItems.push({ label: '待审核商户', value: stats.pendingMerchants, color: '#722ed1' })

    const systemStatusHtml = `
      <div class="ad-status-card">
        <div style="font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:10px">系统状态</div>
        <div class="ad-status-row">
          <div class="ad-status-left">
            <span class="ad-status-dot" style="background:#52c41a"></span>
            <span class="ad-status-label">服务状态</span>
          </div>
          <span class="ad-status-value" style="color:#52c41a">正常运行</span>
        </div>
        <div class="ad-status-row">
          <div class="ad-status-left">
            <span class="ad-status-dot" style="background:#1677ff"></span>
            <span class="ad-status-label">API 状态</span>
          </div>
          <span class="ad-status-value" style="color:#1677ff">响应正常</span>
        </div>
        ${pendingItems.length > 0 ? pendingItems.map(p => `
          <div class="ad-status-row">
            <div class="ad-status-left">
              <span class="ad-status-dot" style="background:${p.color}"></span>
              <span class="ad-status-label">${p.label}</span>
            </div>
            <span class="ad-status-value" style="color:${p.color};font-weight:600">${p.value} 件</span>
          </div>
        `).join('') : `
          <div class="ad-status-row">
            <div class="ad-status-left">
              <span class="ad-status-dot" style="background:#52c41a"></span>
              <span class="ad-status-label">待审核事项</span>
            </div>
            <span class="ad-status-value" style="color:#52c41a">无</span>
          </div>
        `}
        <div class="ad-status-row">
          <div class="ad-status-left">
            <span class="ad-status-dot" style="background:#999"></span>
            <span class="ad-status-label">服务器时间</span>
          </div>
          <span class="ad-status-value">${new Date().toLocaleString('zh-CN')}</span>
        </div>
      </div>
    `

    container.innerHTML = statCardsHtml + quickLinksHtml + systemStatusHtml
  } catch (e) {
    container.innerHTML = `
      <div style="padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px;opacity:0.4">⚠️</div>
        <div style="font-size:15px;color:var(--kb-text-secondary)">加载失败：${e.message}</div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="renderAdminDashboard()">重试</button>
      </div>
    `
  }
}

// 用户管理
async function renderAdminUsers() {
  app.innerHTML = `
    <div class="page">
      <style>
        .au-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
        .au-header .au-back{font-size:20px;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .au-header .au-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .au-search-card{background:#fff;border-radius:12px;margin:12px 16px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .au-search-row{display:flex;gap:8px;margin-bottom:10px}
        .au-search-row input{flex:1}
        .au-search-row select{width:120px}
        .au-filter-chips{display:flex;gap:6px;flex-wrap:wrap}
        .au-chip{padding:5px 12px;border-radius:16px;font-size:12px;background:#f5f5f5;color:var(--kb-text-secondary);cursor:pointer;border:1px solid transparent}
        .au-chip.active{background:var(--kb-primary);color:#fff;border-color:var(--kb-primary)}
        .au-user-card{background:#fff;border-radius:12px;margin:0 16px 10px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .au-user-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
        .au-user-avatar{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:#fff;flex-shrink:0}
        .au-user-info{flex:1;margin-left:10px}
        .au-user-name{font-size:14px;font-weight:600;color:var(--kb-text)}
        .au-user-meta{font-size:11px;color:var(--kb-text-tertiary);margin-top:2px}
        .au-status-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
        .au-status-dot{width:6px;height:6px;border-radius:50%}
        .au-risk-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
        .au-user-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
        .au-user-actions .btn{flex:1;min-width:60px;font-size:11px;padding:5px 8px;margin-top:0}
        .au-pagination{display:flex;justify-content:center;align-items:center;gap:8px;padding:16px;font-size:13px;color:var(--kb-text-secondary)}
        .au-pagination button{padding:6px 12px;border-radius:6px;border:1px solid var(--kb-border);background:#fff;cursor:pointer;font-size:12px}
        .au-pagination button:disabled{opacity:0.4;cursor:not-allowed}
        .au-pagination button.active{background:var(--kb-primary);color:#fff;border-color:var(--kb-primary)}
      </style>

      <div class="au-header">
        <div class="au-back" onclick="history.back()">‹</div>
        <div class="au-title">用户管理</div>
        <div style="width:32px"></div>
      </div>

      ${renderAdminNav('adminUsers')}

      <div class="au-search-card">
        <div class="au-search-row">
          <input class="form-input" id="searchKeyword" placeholder="搜索手机号 / 邮箱 / 昵称 / 用户ID" style="font-size:13px">
          <button class="btn btn-primary" id="btnSearch" style="min-width:70px">查询</button>
        </div>
        <div class="au-filter-chips">
          <span class="au-chip active" data-status="">全部</span>
          <span class="au-chip" data-status="ACTIVE">正常</span>
          <span class="au-chip" data-status="FROZEN">冻结</span>
          <span class="au-chip" data-status="EXPENSE_RESTRICTED">限制支出</span>
        </div>
      </div>

      <div id="userListContainer">
        <div style="padding:32px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>
      </div>
    </div>
  `
  bindAdminNav()

  const statusConfig = {
    ACTIVE: { label: '正常', bg: '#f6ffed', color: '#52c41a', dot: '#52c41a' },
    FROZEN: { label: '冻结', bg: '#fff1f0', color: '#f5222d', dot: '#f5222d' },
    EXPENSE_RESTRICTED: { label: '限制支出', bg: '#fff7e6', color: '#fa8c16', dot: '#fa8c16' },
  }
  const riskConfig = {
    LOW: { label: '低', bg: '#f6ffed', color: '#52c41a' },
    MEDIUM: { label: '中', bg: '#fff7e6', color: '#fa8c16' },
    HIGH: { label: '高', bg: '#fff1f0', color: '#f5222d' },
  }
  const avatarColors = ['#1677ff', '#52c41a', '#722ed1', '#fa8c16', '#f5222d', '#13c2c2', '#eb2f96']

  let currentPage = 1
  const PAGE_SIZE = 10
  let currentKeyword = ''
  let currentStatus = ''

  const load = async () => {
    const params = new URLSearchParams()
    if (currentKeyword) params.set('keyword', currentKeyword)
    if (currentStatus) params.set('status', currentStatus)
    params.set('page', String(currentPage))
    params.set('limit', String(PAGE_SIZE))
    const query = params.toString() ? `?${params.toString()}` : ''

    const container = document.getElementById('userListContainer')
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>'

    try {
      const res = await adminApi(`/admin/users${query}`)
      const users = res.data || res
      const total = res.total || users.length
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

      if (users.length === 0) {
        container.innerHTML = `
          <div style="padding:48px 16px;text-align:center">
            <div style="font-size:48px;margin-bottom:12px;opacity:0.4">👥</div>
            <div style="font-size:15px;color:var(--kb-text-secondary)">暂无用户</div>
          </div>
        `
        return
      }

      container.innerHTML = users.map((u, idx) => {
        const sc = statusConfig[u.status] || { label: u.status, bg: '#f5f5f5', color: '#666', dot: '#666' }
        const rc = riskConfig[u.riskLevel] || riskConfig.LOW
        const avatarColor = avatarColors[idx % avatarColors.length]
        const initials = (u.nickname || u.phone || u.email || 'U').charAt(0).toUpperCase()

        return `
          <div class="au-user-card">
            <div class="au-user-top">
              <div class="au-user-avatar" style="background:${avatarColor}">${initials}</div>
              <div class="au-user-info">
                <div class="au-user-name">${u.nickname || '未设置昵称'}</div>
                <div class="au-user-meta">${u.phone || u.email || ''} · 注册 ${fmtTime(u.createdAt)}</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                <span class="au-status-badge" style="background:${sc.bg};color:${sc.color}">
                  <span class="au-status-dot" style="background:${sc.dot}"></span>
                  ${sc.label}
                </span>
                <span class="au-risk-badge" style="background:${rc.bg};color:${rc.color}">风险: ${rc.label}</span>
              </div>
            </div>

            <div class="au-user-actions">
              <button class="btn btn-secondary" onclick="showUserDetail('${u.id}')">详情</button>
              <button class="btn btn-secondary" onclick="adjustUserAccount('${u.id}')">调账</button>
              <button class="btn btn-secondary" onclick="changeUserRiskLevel('${u.id}')">风险</button>
              ${u.status !== 'ACTIVE' ? `<button class="btn btn-primary" onclick="changeUserStatus('${u.id}', 'ACTIVE')">正常</button>` : ''}
              ${u.status !== 'FROZEN' ? `<button class="btn btn-secondary" onclick="changeUserStatus('${u.id}', 'FROZEN')">冻结</button>` : ''}
            </div>
          </div>
        `
      }).join('') + `
        <div class="au-pagination">
          <span>共 ${total} 条 / ${totalPages} 页</span>
          <button ${currentPage <= 1 ? 'disabled' : ''} onclick="adminUsersPage(${currentPage - 1})">上一页</button>
          ${Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
            const p = start + i
            if (p > totalPages) return ''
            return `<button class="${p === currentPage ? 'active' : ''}" onclick="adminUsersPage(${p})">${p}</button>`
          }).join('')}
          <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="adminUsersPage(${currentPage + 1})">下一页</button>
        </div>
      `
    } catch (e) {
      container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
    }
  }

  window.adminUsersPage = (p) => { currentPage = p; load() }

  window.showUserDetail = async (id) => {
    try {
      const u = await adminApi(`/admin/users/${id}`)
      const statusMap = { UNVERIFIED: '未认证', PENDING: '审核中', VERIFIED: '已认证', REJECTED: '已拒绝' }
      const acc = u.account || {}
      const identity = u.identity || {}
      showModal('用户详情', `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--kb-border-light)">
          <div style="width:48px;height:48px;border-radius:12px;background:var(--kb-primary);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:600">${(u.nickname || 'U').charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--kb-text)">${u.nickname || '-'}</div>
            <div style="font-size:12px;color:var(--kb-text-tertiary)">${u.phone || u.email || '-'}</div>
          </div>
        </div>
        <div class="ma-field-row"><span class="ma-field-label">用户ID</span><span class="ma-field-value" style="font-size:11px">${u.id}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">账户状态</span><span class="au-status-badge" style="background:${statusConfig[u.status]?.bg || '#f5f5f5'};color:${statusConfig[u.status]?.color || '#666'}">${u.status}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">风险等级</span><span class="au-risk-badge" style="background:${riskConfig[u.riskLevel]?.bg || '#f6ffed'};color:${riskConfig[u.riskLevel]?.color || '#52c41a'}">${riskConfig[u.riskLevel]?.label || u.riskLevel || 'LOW'}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">实名状态</span><span class="ma-field-value">${statusMap[u.realNameStatus] || u.realNameStatus || '未认证'}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">真实姓名</span><span class="ma-field-value">${identity.realName || '-'}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">身份证号</span><span class="ma-field-value">${identity.realName ? maskIdCard(identity.idCard) : '-'}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">可用余额</span><span class="ma-field-value">¥${fmtMoney(acc.availableBalanceYuan)}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">冻结余额</span><span class="ma-field-value">¥${fmtMoney(acc.frozenBalanceYuan)}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">总资产</span><span class="ma-field-value" style="font-weight:600;color:#722ed1">¥${fmtMoney(acc.totalBalanceYuan)}</span></div>
        <div class="ma-field-row"><span class="ma-field-label">注册时间</span><span class="ma-field-value">${fmtTime(u.createdAt)}</span></div>
      `)
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  window.adjustUserAccount = (id) => {
    showModal('手动调账', `
      <div style="margin-bottom:10px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">调账金额（元，正数加款 / 负数扣款）</label>
        <input class="form-input" id="adjustAmount" type="number" placeholder="例如：100 或 -50">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">调账原因</label>
        <input class="form-input" id="adjustReason" placeholder="请输入调账原因">
      </div>
      <button class="btn btn-primary" id="btnConfirmAdjust" style="width:100%">确认调账</button>
    `)
    document.getElementById('btnConfirmAdjust').onclick = async () => {
      const amount = Number(document.getElementById('adjustAmount').value)
      const reason = document.getElementById('adjustReason').value.trim()
      if (isNaN(amount) || amount === 0) return showToast('请输入非零金额')
      if (!reason) return showToast('请填写调账原因')
      try {
        await adminApi(`/admin/accounts/${id}/adjust`, { method: 'POST', body: JSON.stringify({ amount, reason }) })
        showToast('调账成功', 'success')
        document.querySelector('.modal-overlay')?.remove()
        await load()
      } catch (e) { showToast(e.message || '操作失败', 'error') }
    }
  }

  window.changeUserRiskLevel = (id) => {
    showModal('修改风险等级', `
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">风险等级</label>
        <select class="form-input" id="riskLevelSelect">
          <option value="LOW">低（LOW）</option>
          <option value="MEDIUM">中（MEDIUM）</option>
          <option value="HIGH">高（HIGH）</option>
        </select>
      </div>
      <button class="btn btn-primary" id="btnConfirmRisk" style="width:100%">确认修改</button>
    `)
    document.getElementById('btnConfirmRisk').onclick = async () => {
      const level = document.getElementById('riskLevelSelect').value
      try {
        await adminApi(`/admin/users/${id}/risk-level`, { method: 'POST', body: JSON.stringify({ level }) })
        showToast('风险等级已修改', 'success')
        document.querySelector('.modal-overlay')?.remove()
        await load()
      } catch (e) { showToast(e.message || '操作失败', 'error') }
    }
  }

  window.changeUserStatus = async (id, status) => {
    if (!confirm(`确定将该用户状态修改为 ${status} 吗？`)) return
    try {
      await adminApi(`/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
      showToast('状态修改成功', 'success')
      await load()
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  document.querySelectorAll('.au-chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('.au-chip').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
      currentStatus = chip.getAttribute('data-status')
      currentPage = 1
      load()
    }
  })

  document.getElementById('btnSearch').onclick = () => {
    currentKeyword = document.getElementById('searchKeyword').value.trim()
    currentPage = 1
    load()
  }

  try { await load() } catch (e) {
    document.getElementById('userListContainer').innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
  }
}

// 商户审核
async function renderAdminMerchants() {
  app.innerHTML = `
    <div class="page">
      <style>
        .am-header{display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
        .am-header .am-back{font-size:20px;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
        .am-header .am-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .am-tabs{display:flex;padding:0 16px;margin-bottom:12px;gap:8px;overflow-x:auto}
        .am-tab{padding:8px 16px;border-radius:20px;font-size:13px;background:#fff;color:var(--kb-text-secondary);cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
        .am-tab.active{background:var(--kb-primary);color:#fff}
        .am-merchant-card{background:#fff;border-radius:12px;margin:0 16px 12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
        .am-merchant-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
        .am-merchant-name{font-size:16px;font-weight:600;color:var(--kb-text)}
        .am-merchant-no{font-size:12px;color:var(--kb-text-tertiary);margin-top:2px;font-family:monospace}
        .am-status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
        .am-status-dot{width:6px;height:6px;border-radius:50%}
        .am-field-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--kb-border-light)}
        .am-field-row:last-child{border-bottom:none}
        .am-field-label{font-size:12px;color:var(--kb-text-secondary)}
        .am-field-value{font-size:13px;color:var(--kb-text)}
        .am-actions{display:flex;gap:8px;margin-top:12px}
        .am-actions .btn{flex:1}
        .am-reject-area{margin-top:10px;display:none}
        .am-rate-card{background:#f6ffed;border:1px solid #b7eb8f;border-radius:12px;margin:0 16px 12px;padding:16px}
        .am-rate-row{display:flex;justify-content:space-between;padding:6px 0}
        .am-pagination{display:flex;justify-content:center;align-items:center;gap:8px;padding:16px;font-size:13px;color:var(--kb-text-secondary)}
        .am-pagination button{padding:6px 12px;border-radius:6px;border:1px solid var(--kb-border);background:#fff;cursor:pointer;font-size:12px}
        .am-pagination button:disabled{opacity:0.4;cursor:not-allowed}
        .am-pagination button.active{background:var(--kb-primary);color:#fff;border-color:var(--kb-primary)}
      </style>

      <div class="am-header">
        <div class="am-back" onclick="history.back()">‹</div>
        <div class="am-title">商户管理</div>
        <div style="width:32px"></div>
      </div>

      ${renderAdminNav('adminMerchants')}

      <div class="am-tabs" id="amTabs">
        <div class="am-tab active" data-status="PENDING">待审核</div>
        <div class="am-tab" data-status="APPROVED">已通过</div>
        <div class="am-tab" data-status="REJECTED">已拒绝</div>
        <div class="am-tab" data-status="">全部</div>
      </div>

      <div id="merchantListContainer">
        <div style="padding:32px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>
      </div>
    </div>
  `
  bindAdminNav()

  const statusConfig = {
    PENDING: { label: '审核中', bg: '#fff7e6', color: '#fa8c16', dot: '#fa8c16' },
    APPROVED: { label: '已通过', bg: '#f6ffed', color: '#52c41a', dot: '#52c41a' },
    REJECTED: { label: '已拒绝', bg: '#fff1f0', color: '#f5222d', dot: '#f5222d' },
  }

  let currentStatus = 'PENDING'
  let currentPage = 1
  const PAGE_SIZE = 10

  const load = async () => {
    const container = document.getElementById('merchantListContainer')
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--kb-text-secondary)">加载中...</div>'
    try {
      const params = new URLSearchParams({ page: String(currentPage), limit: String(PAGE_SIZE) })
      if (currentStatus) params.set('status', currentStatus)
      const res = await adminApi(`/admin/merchants?${params.toString()}`)
      const list = res.data || res
      const total = res.total || list.length
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

      if (list.length === 0) {
        container.innerHTML = `
          <div style="padding:48px 16px;text-align:center">
            <div style="font-size:48px;margin-bottom:12px;opacity:0.4">🏪</div>
            <div style="font-size:15px;color:var(--kb-text-secondary)">${currentStatus ? '暂无该状态的商户' : '暂无商户'}</div>
          </div>
        `
        return
      }

      container.innerHTML = list.map((m) => {
        const sc = statusConfig[m.status] || { label: m.status, bg: '#f5f5f5', color: '#666', dot: '#666' }
        return `
          <div class="am-merchant-card">
            <div class="am-merchant-top">
              <div>
                <div class="am-merchant-name">${m.merchantName || '未命名'}</div>
                <div class="am-merchant-no">${m.merchantNo || '-'}</div>
              </div>
              <span class="am-status-badge" style="background:${sc.bg};color:${sc.color}">
                <span class="am-status-dot" style="background:${sc.dot}"></span>
                ${sc.label}
              </span>
            </div>

            <div class="am-field-row">
              <span class="am-field-label">商户类型</span>
              <span class="am-field-value">${m.merchantType === 'ENTERPRISE' ? '企业' : '个人'}</span>
            </div>
            <div class="am-field-row">
              <span class="am-field-label">联系人</span>
              <span class="am-field-value">${m.contactName || '-'} ${m.contactPhone || ''}</span>
            </div>
            <div class="am-field-row">
              <span class="am-field-label">结算账户</span>
              <span class="am-field-value" style="font-size:12px">${m.settleAccount || '-'}</span>
            </div>
            ${m.payRate != null ? `
              <div class="am-field-row">
                <span class="am-field-label">收款费率</span>
                <span class="am-field-value" style="color:#722ed1;font-weight:600">${(m.payRate / 100).toFixed(2)}%</span>
              </div>
            ` : ''}
            ${m.withdrawRate != null ? `
              <div class="am-field-row">
                <span class="am-field-label">提现费率</span>
                <span class="am-field-value" style="color:#722ed1;font-weight:600">${(m.withdrawRate / 100).toFixed(2)}%</span>
              </div>
            ` : ''}
            ${m.dailyLimitYuan != null ? `
              <div class="am-field-row">
                <span class="am-field-label">日限额</span>
                <span class="am-field-value">¥${fmtMoney(m.dailyLimitYuan)}</span>
              </div>
            ` : ''}
            ${m.rejectReason ? `
              <div style="background:#fff1f0;border:1px solid #ffccc7;padding:8px 12px;border-radius:8px;font-size:12px;color:#cf1322;margin-top:8px">
                拒绝原因：${m.rejectReason}
              </div>
            ` : ''}

            ${m.status === 'PENDING' ? `
              <div class="am-actions">
                <button class="btn btn-primary" onclick="auditMerchantAdmin('${m.id}', 'APPROVED')">通过</button>
                <button class="btn btn-secondary" onclick="showRejectMerchant('${m.id}')">拒绝</button>
              </div>
              <div class="am-reject-area" id="reject-merchant-${m.id}">
                <div style="margin-top:10px">
                  <input class="form-input" id="reason-merchant-${m.id}" placeholder="请输入拒绝原因" style="font-size:12px">
                </div>
                <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="auditMerchantAdmin('${m.id}', 'REJECTED')">确认拒绝</button>
              </div>
            ` : ''}

            ${m.status === 'APPROVED' ? `
              <div class="am-rate-card" style="margin:12px -16px -16px;border-radius:0 0 12px 12px;border-top:1px solid #b7eb8f">
                <div style="font-size:12px;font-weight:600;color:#52c41a;margin-bottom:6px">费率配置</div>
                <div class="am-rate-row">
                  <span style="font-size:12px;color:var(--kb-text-secondary)">收款费率</span>
                  <span style="font-size:13px;font-weight:600;color:var(--kb-text)">${m.payRate != null ? (m.payRate / 100).toFixed(2) + '%' : '默认'}</span>
                </div>
                <div class="am-rate-row">
                  <span style="font-size:12px;color:var(--kb-text-secondary)">提现费率</span>
                  <span style="font-size:13px;font-weight:600;color:var(--kb-text)">${m.withdrawRate != null ? (m.withdrawRate / 100).toFixed(2) + '%' : '默认'}</span>
                </div>
                <div class="am-rate-row">
                  <span style="font-size:12px;color:var(--kb-text-secondary)">日限额</span>
                  <span style="font-size:13px;font-weight:600;color:var(--kb-text)">${m.dailyLimitYuan != null ? '¥' + fmtMoney(m.dailyLimitYuan) : '无限制'}</span>
                </div>
                <div style="display:flex;gap:8px;margin-top:8px">
                  <button class="btn btn-secondary" style="flex:1;font-size:11px;padding:5px 8px;margin-top:0" onclick="editMerchantRate('${m.id}', ${m.payRate || 0}, ${m.withdrawRate || 0}, ${m.dailyLimitYuan || 0})">修改费率</button>
                </div>
              </div>
            ` : ''}
          </div>
        `
      }).join('') + `
        <div class="am-pagination">
          <span>共 ${total} 条 / ${totalPages} 页</span>
          <button ${currentPage <= 1 ? 'disabled' : ''} onclick="adminMerchantsPage(${currentPage - 1})">上一页</button>
          ${Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
            const p = start + i
            if (p > totalPages) return ''
            return `<button class="${p === currentPage ? 'active' : ''}" onclick="adminMerchantsPage(${p})">${p}</button>`
          }).join('')}
          <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="adminMerchantsPage(${currentPage + 1})">下一页</button>
        </div>
      `
    } catch (e) {
      container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
    }
  }

  window.adminMerchantsPage = (p) => { currentPage = p; load() }

  window.auditMerchantAdmin = async (id, status) => {
    const action = status === 'REJECTED' ? 'REJECT' : 'APPROVE'
    const body = { action }
    if (status === 'REJECTED') {
      body.reason = document.getElementById(`reason-merchant-${id}`).value.trim()
      if (!body.reason) return showToast('请填写拒绝原因')
    }
    try {
      await adminApi(`/admin/merchants/${id}/audit`, { method: 'POST', body: JSON.stringify(body) })
      showToast('审核操作成功', 'success')
      await load()
    } catch (e) { showToast(e.message || '操作失败', 'error') }
  }

  window.showRejectMerchant = (id) => {
    const el = document.getElementById(`reject-merchant-${id}`)
    if (el) el.style.display = el.style.display === 'none' || !el.style.display ? 'block' : 'none'
  }

  window.editMerchantRate = (id, payRate, withdrawRate, dailyLimit) => {
    showModal('修改费率配置', `
      <div style="margin-bottom:10px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">收款费率（%）</label>
        <input class="form-input" id="editPayRate" type="number" step="0.01" value="${(payRate / 100).toFixed(2)}" placeholder="如 0.60">
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">提现费率（%）</label>
        <input class="form-input" id="editWithdrawRate" type="number" step="0.01" value="${(withdrawRate / 100).toFixed(2)}" placeholder="如 1.00">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--kb-text-secondary);display:block;margin-bottom:4px">日限额（元）</label>
        <input class="form-input" id="editDailyLimit" type="number" value="${dailyLimit || ''}" placeholder="留空表示无限制">
      </div>
      <button class="btn btn-primary" id="btnSaveRate" style="width:100%">保存配置</button>
    `)
    document.getElementById('btnSaveRate').onclick = async () => {
      const payRateVal = Number(document.getElementById('editPayRate').value)
      const withdrawRateVal = Number(document.getElementById('editWithdrawRate').value)
      const dailyLimitVal = Number(document.getElementById('editDailyLimit').value)
      const body = {}
      if (!isNaN(payRateVal)) body.payRate = Math.round(payRateVal * 100)
      if (!isNaN(withdrawRateVal)) body.withdrawRate = Math.round(withdrawRateVal * 100)
      if (dailyLimitVal) body.dailyLimit = Math.round(dailyLimitVal * 100)
      try {
        await adminApi(`/admin/merchants/${id}/rate`, { method: 'POST', body: JSON.stringify(body) })
        showToast('费率配置已更新', 'success')
        document.querySelector('.modal-overlay')?.remove()
        await load()
      } catch (e) { showToast(e.message || '操作失败', 'error') }
    }
  }

  document.querySelectorAll('#amTabs .am-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('#amTabs .am-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      currentStatus = tab.getAttribute('data-status')
      currentPage = 1
      load()
    }
  })

  try { await load() } catch (e) {
    document.getElementById('merchantListContainer').innerHTML = `<div style="padding:32px;text-align:center;color:var(--kb-error)">加载失败：${e.message}</div>`
  }
}

// 提现审核
async function renderAdminWithdrawals() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminWithdrawals')}
      <div class="card" id="withdrawalList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    const res = await adminApi('/admin/withdrawals?status=PENDING')
    const list = res.data || res
    const container = document.getElementById('withdrawalList')
    if (list.length === 0) {
      container.innerHTML = '<div class="empty">暂无待审核提现</div>'
    } else {
      container.innerHTML = list.map((w) => `
        <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div class="bill-type">提现 ¥${fmtMoney(w.amountYuan)}</div>
            <div class="bill-amount">${w.status}</div>
          </div>
          <div class="bill-time">用户：${w.user?.nickname || w.user?.phone || w.userId || ''} · 到账账户：${w.channelAccount || ''} · ${fmtTime(w.createdAt)}</div>
          <div style="display:flex;gap:8px;width:100%;margin-top:4px">
            <button class="btn btn-primary" style="flex:1;margin-top:0" onclick="approveWithdrawal('${w.id}')">通过</button>
            <button class="btn btn-secondary" style="flex:1;margin-top:0" onclick="showRejectWithdrawal('${w.id}')">拒绝</button>
          </div>
          <div id="reject-withdrawal-${w.id}" style="display:none;width:100%">
            <input class="form-input" id="reason-withdrawal-${w.id}" placeholder="请输入拒绝原因" style="margin-top:8px">
            <button class="btn btn-primary" style="margin-top:8px" onclick="rejectWithdrawal('${w.id}')">确认拒绝</button>
          </div>
        </div>
      `).join('')
    }
  }

  window.approveWithdrawal = async (id) => {
    if (!confirm('确定通过该提现申请吗？')) return
    try {
      await adminApi(`/admin/withdrawals/${id}/approve`, { method: 'POST' })
      showToast('已通过', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.rejectWithdrawal = async (id) => {
    const reason = document.getElementById(`reason-withdrawal-${id}`).value.trim()
    if (!reason) return showToast('请填写拒绝原因')
    if (!confirm('确定拒绝该提现申请吗？')) return
    try {
      await adminApi(`/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      showToast('已拒绝', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.showRejectWithdrawal = (id) => {
    const el = document.getElementById(`reject-withdrawal-${id}`)
    el.style.display = el.style.display === 'none' ? 'block' : 'none'
  }

  try {
    await load()
  } catch (e) {
    document.getElementById('withdrawalList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 风险事件
async function renderAdminRiskEvents() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminRiskEvents')}
      <div class="card" id="riskList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    const list = await adminApi('/admin/risk-events')
    const container = document.getElementById('riskList')
    if (list.length === 0) {
      container.innerHTML = '<div class="empty">暂无风险事件</div>'
    } else {
      container.innerHTML = list.map((r) => `
        <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div class="bill-type">${r.type || '风险事件'}</div>
            <div class="bill-amount">${r.level || '低'}</div>
          </div>
          <div class="bill-time">用户：${r.userId || r.user?.id || ''} · ${r.description || ''}</div>
          <div class="bill-time">状态：${r.handled ? '已处理' : '未处理'} · ${fmtTime(r.createdAt)}</div>
          ${!r.handled ? `
            <div style="display:flex;gap:8px;width:100%;margin-top:4px">
              <button class="btn btn-primary" style="flex:1;margin-top:0" onclick="handleRiskEvent('${r.id}')">标记已处理</button>
            </div>
          ` : ''}
        </div>
      `).join('')
    }
  }

  window.handleRiskEvent = async (id) => {
    if (!confirm('确定标记该风险事件为已处理吗？')) return
    try {
      await adminApi(`/admin/risk-events/${id}/handle`, { method: 'POST' })
      showToast('已标记为已处理', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  try {
    await load()
  } catch (e) {
    document.getElementById('riskList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 系统配置
async function renderAdminConfigs() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminConfigs')}
      <div class="card">
        <div class="section-title">新增 / 修改配置</div>
        <div class="form-group">
          <label class="form-label">配置 Key</label>
          <input class="form-input" id="configKey" placeholder="例如：WITHDRAW_FEE_RATE">
        </div>
        <div class="form-group">
          <label class="form-label">配置 Value</label>
          <input class="form-input" id="configValue" placeholder="例如：0.01">
        </div>
        <button class="btn btn-primary" id="btnSaveConfig">保存</button>
      </div>
      <div class="card" id="configList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    const configs = await adminApi('/admin/system-configs')
    const container = document.getElementById('configList')
    if (configs.length === 0) {
      container.innerHTML = '<div class="empty">暂无配置</div>'
    } else {
      container.innerHTML = `
        <div class="section-title">现有配置</div>
        ${configs.map((c) => `
          <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <div class="bill-type">${c.key}</div>
              <div class="bill-amount">${c.value}</div>
            </div>
            <div class="bill-time">更新时间：${fmtTime(c.updatedAt)}</div>
          </div>
        `).join('')}
      `
    }
  }

  document.getElementById('btnSaveConfig').onclick = async () => {
    const key = document.getElementById('configKey').value.trim()
    const value = document.getElementById('configValue').value.trim()
    if (!key) return showToast('请填写配置 Key')
    try {
      await adminApi('/admin/system-configs', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      })
      showToast('配置保存成功', 'success')
      document.getElementById('configKey').value = ''
      document.getElementById('configValue').value = ''
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  try {
    await load()
  } catch (e) {
    document.getElementById('configList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 支付订单管理
async function renderAdminOrders() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminOrders')}
      <div class="card">
        <div class="form-group">
          <label class="form-label">状态</label>
          <select class="form-input" id="statusFilter">
            <option value="">全部</option>
            <option value="PENDING">待支付</option>
            <option value="PAID">已支付</option>
            <option value="CLOSED">已关闭</option>
            <option value="EXPIRED">已过期</option>
          </select>
        </div>
        <button class="btn btn-primary" id="btnSearch">查询</button>
      </div>
      <div class="card" id="orderList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const statusMap = { PENDING: '待支付', PAID: '已支付', CLOSED: '已关闭', EXPIRED: '已过期' }

  const load = async () => {
    const status = document.getElementById('statusFilter').value
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    const query = params.toString() ? `?${params.toString()}` : ''
    const res = await adminApi(`/admin/payment-orders${query}`)
    const list = res.data || res
    const container = document.getElementById('orderList')
    if (list.length === 0) {
      container.innerHTML = '<div class="empty">暂无支付订单</div>'
    } else {
      container.innerHTML = list.map((o) => `
        <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div class="bill-type">¥${fmtMoney(o.amountYuan)} · ${o.merchant?.merchantName || '-'}</div>
            <div class="bill-amount">${statusMap[o.status] || o.status}</div>
          </div>
          <div class="bill-time">订单号：${o.orderNo} · 商品：${o.subject || '-'}</div>
          <div class="bill-time">手续费：¥${fmtMoney(o.feeYuan)} · 创建：${fmtTime(o.createdAt)}${o.paidAt ? ' · 支付：' + fmtTime(o.paidAt) : ''}</div>
        </div>
      `).join('')
    }
  }

  document.getElementById('btnSearch').onclick = load
  try {
    await load()
  } catch (e) {
    document.getElementById('orderList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 财务报表
async function renderAdminFinance() {
  const today = fmtDate(new Date())
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 6)
  const defaultStart = fmtDate(weekAgo)

  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminFinance')}
      <div class="tabs">
        <div class="tab active" data-tab="overview">大盘概览</div>
        <div class="tab" data-tab="daily">日报汇总</div>
        <div class="tab" data-tab="settlement">商户结算</div>
        <div class="tab" data-tab="fee">手续费收入</div>
        <div class="tab" data-tab="snapshot">日报快照</div>
      </div>
      <div id="financeContent">
        <div class="empty">加载中...</div>
      </div>
    </div>
  `
  bindAdminNav()

  const content = document.getElementById('financeContent')
  const tabs = document.querySelectorAll('.tab[data-tab]')

  const switchTab = async (tab) => {
    tabs.forEach((t) => t.classList.remove('active'))
    const target = document.querySelector(`.tab[data-tab="${tab}"]`)
    if (target) target.classList.add('active')
    if (tab === 'overview') await renderOverview()
    else if (tab === 'daily') await renderDaily()
    else if (tab === 'settlement') await renderSettlement()
    else if (tab === 'fee') await renderFee()
    else if (tab === 'snapshot') await renderSnapshot()
  }

  tabs.forEach((tab) => {
    tab.onclick = () => switchTab(tab.getAttribute('data-tab'))
  })

  async function renderOverview() {
    content.innerHTML = `
      <div class="card">
        <div class="form-group">
          <label class="form-label">开始日期</label>
          <input class="form-input" type="date" id="overviewStart" value="${defaultStart}">
        </div>
        <div class="form-group">
          <label class="form-label">结束日期</label>
          <input class="form-input" type="date" id="overviewEnd" value="${today}">
        </div>
        <button class="btn btn-primary" id="btnQueryOverview">查询</button>
      </div>
      <div id="overviewCards"><div class="empty">加载中...</div></div>
    `
    const load = async () => {
      const startDate = document.getElementById('overviewStart').value
      const endDate = document.getElementById('overviewEnd').value
      try {
        const d = await adminApi(`/admin/finance/overview?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
        document.getElementById('overviewCards').innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:12px">
            <div class="card" style="text-align:center">
              <div class="bill-time">流水总额</div>
              <div class="bill-amount">¥${fmtMoney(d.totalTurnoverYuan)}</div>
            </div>
            <div class="card" style="text-align:center">
              <div class="bill-time">净收入</div>
              <div class="bill-amount income">¥${fmtMoney(d.netIncomeYuan)}</div>
            </div>
            <div class="card" style="text-align:center">
              <div class="bill-time">手续费收入</div>
              <div class="bill-amount income">¥${fmtMoney(d.totalFeeYuan)}</div>
            </div>
            <div class="card" style="text-align:center">
              <div class="bill-time">总资产</div>
              <div class="bill-amount">¥${fmtMoney(d.totalAssetsYuan)}</div>
            </div>
            <div class="card" style="text-align:center">
              <div class="bill-time">交易笔数</div>
              <div class="bill-amount">${d.transactionCount || 0} 笔</div>
            </div>
          </div>
        `
      } catch (e) {
        document.getElementById('overviewCards').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
      }
    }
    document.getElementById('btnQueryOverview').onclick = load
    await load()
  }

  async function renderDaily() {
    content.innerHTML = `
      <div class="card">
        <div class="form-group">
          <label class="form-label">开始日期</label>
          <input class="form-input" type="date" id="startDate" value="${defaultStart}">
        </div>
        <div class="form-group">
          <label class="form-label">结束日期</label>
          <input class="form-input" type="date" id="endDate" value="${today}">
        </div>
        <button class="btn btn-primary" id="btnQueryDaily">查询</button>
        <button class="btn btn-secondary" id="btnExportDaily" style="margin-left:8px">导出 CSV</button>
      </div>
      <div class="card" id="dailyList"><div class="empty">加载中...</div></div>
    `
    const load = async () => {
      const startDate = document.getElementById('startDate').value
      const endDate = document.getElementById('endDate').value
      try {
        const res = await adminApi(`/admin/finance/daily-summary?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
        const data = res.data || []
        const list = document.getElementById('dailyList')
        if (!data || data.length === 0) {
          list.innerHTML = '<div class="empty">暂无数据</div>'
        } else {
          list.innerHTML = data.map((d) => `
            <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
              <div style="display:flex;justify-content:space-between;width:100%">
                <div class="bill-type">${d.date}</div>
                <div class="bill-amount">${d.transactionCount || 0} 笔</div>
              </div>
              <div class="bill-time">总收入 ¥${fmtMoney(d.totalIncomeYuan)} · 总支出 ¥${fmtMoney(d.totalExpenseYuan)} · 手续费 ¥${fmtMoney(d.totalFeeYuan)}</div>
            </div>
          `).join('')
        }
      } catch (e) {
        document.getElementById('dailyList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
      }
    }
    document.getElementById('btnQueryDaily').onclick = load
    await load()
  }

  async function renderSettlement() {
    content.innerHTML = `
      <div class="card">
        <button class="btn btn-secondary" id="btnExportSettlement">导出 CSV</button>
      </div>
      <div class="card" id="settlementList"><div class="empty">加载中...</div></div>`
    try {
      const res = await adminApi('/admin/finance/merchant-settlements')
      const data = res.data || []
      const list = document.getElementById('settlementList')
      if (!data || data.length === 0) {
        list.innerHTML = '<div class="empty">暂无数据</div>'
      } else {
        list.innerHTML = data.map((d) => `
          <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <div class="bill-type">${d.merchantName || '未知商户'}</div>
              <div class="bill-amount">${d.orderCount || 0} 单</div>
            </div>
            <div class="bill-time">商户号：${d.merchantNo || ''}</div>
            <div class="bill-time">订单金额 ¥${fmtMoney(d.totalAmountYuan)} · 手续费 ¥${fmtMoney(d.totalFeeYuan)} · 结算金额 ¥${fmtMoney(d.settledAmountYuan)}</div>
          </div>
        `).join('')
      }
    } catch (e) {
      content.innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  async function renderFee() {
    content.innerHTML = `
      <div class="card">
        <button class="btn btn-secondary" id="btnExportFee">导出 CSV</button>
      </div>
      <div class="card" id="feeList"><div class="empty">加载中...</div></div>`
    try {
      const res = await adminApi('/admin/finance/fee-income')
      const data = res.data || []
      const list = document.getElementById('feeList')
      if (!data || data.length === 0) {
        list.innerHTML = '<div class="empty">暂无数据</div>'
      } else {
        list.innerHTML = data.map((d) => `
          <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <div class="bill-type">${d.date}</div>
              <div class="bill-amount income">+¥${fmtMoney(d.totalFeeYuan)}</div>
            </div>
            <div class="bill-time">支付手续费 ¥${fmtMoney(d.paymentFeeYuan)} · 提现手续费 ¥${fmtMoney(d.withdrawalFeeYuan)}</div>
          </div>
        `).join('')
      }
    } catch (e) {
      content.innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  async function renderSnapshot() {
    content.innerHTML = `
      <div class="card">
        <button class="btn btn-secondary" id="btnExportSnapshot">导出 CSV</button>
        <button class="btn btn-primary" id="btnGenerateSnapshot" style="margin-left:8px">手动生成</button>
      </div>
      <div class="card" id="snapshotList"><div class="empty">加载中...</div></div>
    `
    const load = async () => {
      try {
        const res = await adminApi('/admin/finance/daily-snapshots')
        const data = res.data || []
        const list = document.getElementById('snapshotList')
        if (!data || data.length === 0) {
          list.innerHTML = '<div class="empty">暂无快照数据</div>'
        } else {
          list.innerHTML = data.map((d) => `
            <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
              <div style="display:flex;justify-content:space-between;width:100%">
                <div class="bill-type">${d.date}</div>
                <div class="bill-amount">${d.transactionCount || 0} 笔</div>
              </div>
              <div class="bill-time">总资产 ¥${fmtMoney(d.totalAssetsYuan)} · 总收入 ¥${fmtMoney(d.totalIncomeYuan)} · 总支出 ¥${fmtMoney(d.totalExpenseYuan)} · 手续费 ¥${fmtMoney(d.totalFeeYuan)}</div>
            </div>
          `).join('')
        }
      } catch (e) {
        document.getElementById('snapshotList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
      }
    }
    document.getElementById('btnExportSnapshot').onclick = () => {
      downloadAdminCsv('/admin/finance/snapshots/export', 'daily-snapshots.csv')
    }
    document.getElementById('btnGenerateSnapshot').onclick = () => {
      const todayStr = fmtDate(new Date())
      const modal = document.createElement('div')
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999'
      modal.innerHTML = `
        <div class="card" style="width:320px;max-width:90vw">
          <div class="form-group">
            <label class="form-label">快照日期</label>
            <input class="form-input" type="date" id="snapshotDate" value="${todayStr}">
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary" id="btnConfirmGenerate">生成</button>
            <button class="btn btn-secondary" id="btnCancelGenerate">取消</button>
          </div>
        </div>
      `
      document.body.appendChild(modal)
      document.getElementById('btnCancelGenerate').onclick = () => document.body.removeChild(modal)
      document.getElementById('btnConfirmGenerate').onclick = async () => {
        const date = document.getElementById('snapshotDate').value
        try {
          await adminApi('/admin/finance/snapshots/generate', { method: 'POST', body: JSON.stringify({ date }) })
          showToast('快照生成成功', 'success')
          document.body.removeChild(modal)
          await load()
        } catch (e) {
          showToast('生成失败：' + e.message, 'error')
        }
      }
    }
    await load()
  }

  await renderOverview()
}

// 对账中心
async function renderAdminReconciliation() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminReconciliation')}
      <div class="card">
        <div class="form-group">
          <label class="form-label">对账日期</label>
          <input class="form-input" type="date" id="reconDate" value="${fmtDate(new Date())}">
        </div>
        <button class="btn btn-primary" id="btnRunRecon">执行对账</button>
      </div>
      <div class="card" id="reportList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    try {
      const res = await adminApi('/admin/reconciliation/reports')
      const reports = res.data || []
      const container = document.getElementById('reportList')
      if (!reports || reports.length === 0) {
        container.innerHTML = '<div class="empty">暂无对账报告</div>'
      } else {
        container.innerHTML = reports.map((r) => {
          let diffInfo = '无'
          if (r.differences) {
            try {
              const diffs = JSON.parse(r.differences)
              if (Array.isArray(diffs) && diffs.length > 0) {
                diffInfo = diffs.map((d) => d.message || JSON.stringify(d)).join('；')
              }
            } catch {
              diffInfo = r.differences
            }
          }
          return `
            <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
              <div style="display:flex;justify-content:space-between;width:100%">
                <div class="bill-type">${r.date}</div>
                <div class="bill-amount ${r.status === 'SUCCESS' ? 'income' : 'expense'}">${r.status === 'SUCCESS' ? '成功' : '失败'}</div>
              </div>
              <div class="bill-time">差异信息：${diffInfo}</div>
              <div class="bill-time">操作人：${r.checkedBy || '-'} · ${fmtTime(r.checkedAt)}</div>
            </div>
          `
        }).join('')
      }
    } catch (e) {
      document.getElementById('reportList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  document.getElementById('btnRunRecon').onclick = async () => {
    const date = document.getElementById('reconDate').value
    if (!date) return showToast('请选择对账日期')
    try {
      await adminApi('/admin/reconciliation/run', { method: 'POST', body: JSON.stringify({ date }) })
      showToast('对账任务已提交', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  await load()
}

// 实名审核
async function renderAdminIdentity() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminIdentity')}
      <div class="card" id="identityList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    try {
      const params = getHashParamObj()
      const page = Math.max(1, Number(params.page) || 1)
      const limit = Math.max(1, Math.min(50, Number(params.limit) || 20))
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) }).toString()
      const res = await adminApi(`/admin/identity/pending?${qs}`)
      // 后端返回 { data, total, page, limit }；兼容老接口直接返回数组
      const list = Array.isArray(res) ? res : (res.data || [])
      const total = Array.isArray(res) ? list.length : (res.total || 0)
      const curPage = Array.isArray(res) ? page : (res.page || page)
      const container = document.getElementById('identityList')
      if (list.length === 0) {
        container.innerHTML = '<div class="empty">暂无待审核实名</div>'
      } else {
        container.innerHTML = list.map((i) => `
          <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <div class="bill-type">${i.realName} · ${i.user?.nickname || i.user?.phone || i.user?.email || ''}</div>
              <div class="bill-amount">审核中</div>
            </div>
            <div class="bill-time">身份证号：${maskIdCard(i.idCard)} · 提交时间：${fmtTime(i.createdAt)}</div>
            <div style="display:flex;gap:8px;width:100%;margin-top:4px">
              <button class="btn btn-primary" style="flex:1;margin-top:0" onclick="approveIdentity('${i.id}')">通过</button>
              <button class="btn btn-secondary" style="flex:1;margin-top:0" onclick="showRejectIdentity('${i.id}')">拒绝</button>
            </div>
            <div id="reject-identity-${i.id}" style="display:none;width:100%">
              <input class="form-input" id="reason-identity-${i.id}" placeholder="请输入拒绝原因" style="margin-top:8px">
              <button class="btn btn-primary" style="margin-top:8px" onclick="rejectIdentity('${i.id}')">确认拒绝</button>
            </div>
          </div>
        `).join('') + renderPagination(total, curPage, limit, (p) => navigateWithParams(p))
        bindPagination((p) => navigateWithParams(p))
      }
    } catch (e) {
      document.getElementById('identityList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  window.approveIdentity = async (id) => {
    if (!confirm('确定通过该实名审核吗？')) return
    try {
      await adminApi(`/admin/identity/${id}/approve`, { method: 'POST' })
      showToast('已通过', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.rejectIdentity = async (id) => {
    const reason = document.getElementById(`reason-identity-${id}`).value.trim()
    if (!reason) return showToast('请填写拒绝原因')
    if (!confirm('确定拒绝该实名审核吗？')) return
    try {
      await adminApi(`/admin/identity/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      showToast('已拒绝', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.showRejectIdentity = (id) => {
    const el = document.getElementById(`reject-identity-${id}`)
    el.style.display = el.style.display === 'none' ? 'block' : 'none'
  }

  try {
    await load()
  } catch (e) {
    document.getElementById('identityList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 登录日志
async function renderAdminLoginLogs() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminLoginLogs')}
      <div class="card">
        <div class="form-group">
          <label class="form-label">用户ID</label>
          <input class="form-input" id="filterUserId" placeholder="按用户ID筛选（可空）">
        </div>
        <button class="btn btn-primary" id="btnSearch">查询</button>
      </div>
      <div class="card" id="logList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    try {
      const params = getHashParamObj()
      const page = Math.max(1, Number(params.page) || 1)
      const limit = Math.max(1, Math.min(100, Number(params.limit) || 20))
      const query = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (params.userId) query.set('userId', params.userId)
      const res = await adminApi(`/admin/login-logs?${query.toString()}`)
      // 后端返回 { data, total, page, limit }；兼容老接口直接返回数组
      const list = Array.isArray(res) ? res : (res.data || [])
      const total = Array.isArray(res) ? list.length : (res.total || 0)
      const curPage = Array.isArray(res) ? page : (res.page || page)
      const container = document.getElementById('logList')
      if (list.length === 0) {
        container.innerHTML = '<div class="empty">暂无登录日志</div>'
      } else {
        container.innerHTML = list.map((l) => `
          <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <div class="bill-type">${l.user?.nickname || l.user?.phone || l.user?.email || l.userId || '未知用户'}</div>
              <div class="bill-amount ${l.success ? 'income' : 'expense'}">${l.success ? '成功' : '失败'}</div>
            </div>
            <div class="bill-time">IP：${l.ip || '-'} · ${fmtTime(l.createdAt)}</div>
            <div class="bill-time">UA：${l.userAgent || '-'}${l.reason ? ' · 原因：' + l.reason : ''}</div>
          </div>
        `).join('') + renderPagination(total, curPage, limit, (p) => navigateWithParams(p))
        bindPagination((p) => navigateWithParams(p))
      }
    } catch (e) {
      document.getElementById('logList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  document.getElementById('btnSearch').onclick = () => {
    const userId = document.getElementById('filterUserId').value.trim()
    navigateWithParams(1, { userId })
  }

  // 回填筛选条件
  const initParams = getHashParamObj()
  if (initParams.userId) document.getElementById('filterUserId').value = initParams.userId

  try {
    await load()
  } catch (e) {
    document.getElementById('logList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 审计日志（带筛选 + 分页）
async function renderAdminAuditLogs() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminAuditLogs')}
      <div class="card">
        <div class="form-group">
          <label class="form-label">管理员ID</label>
          <input class="form-input" id="filterAdminId" placeholder="按管理员ID筛选（可空）">
        </div>
        <div class="form-group">
          <label class="form-label">操作类型</label>
          <input class="form-input" id="filterAction" placeholder="如 LOGIN / APPROVE_WITHDRAW（可空）">
        </div>
        <div class="form-group">
          <label class="form-label">开始日期</label>
          <input class="form-input" id="filterStartDate" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">结束日期</label>
          <input class="form-input" id="filterEndDate" type="date">
        </div>
        <button class="btn btn-primary" id="btnSearch">查询</button>
      </div>
      <div class="card" id="auditList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    try {
      const params = getHashParamObj()
      const page = Math.max(1, Number(params.page) || 1)
      const limit = Math.max(1, Math.min(100, Number(params.limit) || 20))
      const query = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (params.adminId) query.set('adminId', params.adminId)
      if (params.action) query.set('action', params.action)
      if (params.startDate) query.set('startDate', params.startDate)
      if (params.endDate) query.set('endDate', params.endDate)
      const res = await adminApi(`/admin/audit-logs?${query.toString()}`)
      const list = Array.isArray(res) ? res : (res.data || [])
      const total = Array.isArray(res) ? list.length : (res.total || 0)
      const curPage = Array.isArray(res) ? page : (res.page || page)
      const container = document.getElementById('auditList')
      if (list.length === 0) {
        container.innerHTML = '<div class="empty">暂无审计日志</div>'
      } else {
        const fmtDetail = (d) => {
          if (!d) return ''
          if (typeof d === 'string') return d
          try { return JSON.stringify(d) } catch { return String(d) }
        }
        container.innerHTML = list.map((l) => `
          <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <div class="bill-type">${l.action || '-'}</div>
              <div class="bill-time">${fmtTime(l.createdAt)}</div>
            </div>
            <div class="bill-time">管理员：${l.adminId || '-'}${l.target ? ' · 对象：' + l.target : ''}</div>
            ${l.ip || l.userAgent ? `<div class="bill-time">IP：${l.ip || '-'}${l.userAgent ? ' · UA：' + l.userAgent : ''}</div>` : ''}
            ${l.detail ? `<div class="bill-time" style="word-break:break-all;white-space:pre-wrap">详情：${fmtDetail(l.detail)}</div>` : ''}
          </div>
        `).join('') + renderPagination(total, curPage, limit, (p) => navigateWithParams(p))
        bindPagination((p) => navigateWithParams(p))
      }
    } catch (e) {
      document.getElementById('auditList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  document.getElementById('btnSearch').onclick = () => {
    const adminId = document.getElementById('filterAdminId').value.trim()
    const action = document.getElementById('filterAction').value.trim()
    const startDate = document.getElementById('filterStartDate').value
    const endDate = document.getElementById('filterEndDate').value
    navigateWithParams(1, { adminId, action, startDate, endDate })
  }

  // 回填筛选条件
  const initParams = getHashParamObj()
  if (initParams.adminId) document.getElementById('filterAdminId').value = initParams.adminId
  if (initParams.action) document.getElementById('filterAction').value = initParams.action
  if (initParams.startDate) document.getElementById('filterStartDate').value = initParams.startDate
  if (initParams.endDate) document.getElementById('filterEndDate').value = initParams.endDate

  try {
    await load()
  } catch (e) {
    document.getElementById('auditList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// 风控规则（列表 + 编辑）
async function renderAdminRiskRules() {
  app.innerHTML = `
    <div class="page">
      ${renderAdminNav('adminRiskRules')}
      <div class="card" id="ruleList"><div class="empty">加载中...</div></div>
    </div>
  `
  bindAdminNav()

  const load = async () => {
    try {
      const rules = await adminApi('/admin/risk-rules')
      const container = document.getElementById('ruleList')
      if (!rules || rules.length === 0) {
        container.innerHTML = '<div class="empty">暂无风控规则</div>'
        return
      }
      const actionMap = { BLOCK: '拦截', WARN: '告警', REVIEW: '人工复核' }
      const fmtParams = (p) => {
        if (!p) return '-'
        const parts = []
        if (p.maxAmount != null) parts.push(`单笔≤¥${fmtMoney(p.maxAmount / 100)}`)
        if (p.maxDailyCount != null) parts.push(`日次数≤${p.maxDailyCount}`)
        if (p.maxDailyAmount != null) parts.push(`日金额≤¥${fmtMoney(p.maxDailyAmount / 100)}`)
        if (p.windowSeconds != null) parts.push(`窗口${p.windowSeconds}s`)
        if (p.windowMaxCount != null) parts.push(`窗口次数≤${p.windowMaxCount}`)
        return parts.length ? parts.join(' · ') : '-'
      }
      container.innerHTML = rules.map((r) => `
        <div class="bill-item" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div class="bill-type">${r.name}（${r.code}）</div>
            <div class="bill-amount ${r.enabled ? 'income' : 'expense'}">${r.enabled ? '启用' : '停用'}</div>
          </div>
          <div class="bill-time">动作：${actionMap[r.action] || r.action}</div>
          <div class="bill-time">参数：${fmtParams(r.params)}</div>
          <div style="display:flex;gap:8px;width:100%;margin-top:4px">
            <button class="btn btn-secondary" style="flex:1;margin-top:0;min-width:80px" onclick="editRiskRule('${r.code}')">编辑</button>
            <button class="btn ${r.enabled ? 'btn-secondary' : 'btn-primary'}" style="flex:1;margin-top:0;min-width:80px" onclick="toggleRiskRule('${r.code}', ${!r.enabled})">${r.enabled ? '停用' : '启用'}</button>
          </div>
        </div>
      `).join('')
    } catch (e) {
      document.getElementById('ruleList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  window.editRiskRule = (code) => {
    const bodyHtml = `
      <div class="form-group">
        <label class="form-label">规则名称</label>
        <input class="form-input" id="ruleName" placeholder="规则名称">
      </div>
      <div class="form-group">
        <label class="form-label">动作</label>
        <select class="form-input" id="ruleAction">
          <option value="BLOCK">拦截（BLOCK）</option>
          <option value="WARN">告警（WARN）</option>
          <option value="REVIEW">人工复核（REVIEW）</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">单笔最大金额（元，可空）</label>
        <input class="form-input" id="ruleMaxAmount" type="number" placeholder="如 50000">
      </div>
      <div class="form-group">
        <label class="form-label">每日最大次数（可空）</label>
        <input class="form-input" id="ruleMaxDailyCount" type="number" placeholder="如 10">
      </div>
      <div class="form-group">
        <label class="form-label">每日最大金额（元，可空）</label>
        <input class="form-input" id="ruleMaxDailyAmount" type="number" placeholder="如 100000">
      </div>
      <div class="form-group">
        <label class="form-label">窗口秒数（可空）</label>
        <input class="form-input" id="ruleWindowSeconds" type="number" placeholder="如 60">
      </div>
      <div class="form-group">
        <label class="form-label">窗口内最大次数（可空）</label>
        <input class="form-input" id="ruleWindowMaxCount" type="number" placeholder="如 5">
      </div>
      <button class="btn btn-primary" id="btnSaveRule">保存</button>
    `
    const { close } = showModal(`编辑风控规则 ${code}`, bodyHtml)
    // 先回填当前规则
    adminApi('/admin/risk-rules').then((rules) => {
      const r = (rules || []).find((x) => x.code === code)
      if (!r) return
      document.getElementById('ruleName').value = r.name || ''
      document.getElementById('ruleAction').value = r.action || 'BLOCK'
      if (r.params?.maxAmount != null) document.getElementById('ruleMaxAmount').value = r.params.maxAmount / 100
      if (r.params?.maxDailyCount != null) document.getElementById('ruleMaxDailyCount').value = r.params.maxDailyCount
      if (r.params?.maxDailyAmount != null) document.getElementById('ruleMaxDailyAmount').value = r.params.maxDailyAmount / 100
      if (r.params?.windowSeconds != null) document.getElementById('ruleWindowSeconds').value = r.params.windowSeconds
      if (r.params?.windowMaxCount != null) document.getElementById('ruleWindowMaxCount').value = r.params.windowMaxCount
    }).catch((e) => { showToast('加载配置失败', 'error') })

    document.getElementById('btnSaveRule').onclick = async () => {
      const name = document.getElementById('ruleName').value.trim()
      const action = document.getElementById('ruleAction').value
      const params = {}
      const maxAmount = Number(document.getElementById('ruleMaxAmount').value)
      const maxDailyCount = Number(document.getElementById('ruleMaxDailyCount').value)
      const maxDailyAmount = Number(document.getElementById('ruleMaxDailyAmount').value)
      const windowSeconds = Number(document.getElementById('ruleWindowSeconds').value)
      const windowMaxCount = Number(document.getElementById('ruleWindowMaxCount').value)
      if (!isNaN(maxAmount) && maxAmount > 0) params.maxAmount = Math.round(maxAmount * 100)
      if (!isNaN(maxDailyCount) && maxDailyCount > 0) params.maxDailyCount = maxDailyCount
      if (!isNaN(maxDailyAmount) && maxDailyAmount > 0) params.maxDailyAmount = Math.round(maxDailyAmount * 100)
      if (!isNaN(windowSeconds) && windowSeconds > 0) params.windowSeconds = windowSeconds
      if (!isNaN(windowMaxCount) && windowMaxCount > 0) params.windowMaxCount = windowMaxCount
      const body = { action }
      if (name) body.name = name
      body.params = params
      try {
        await adminApi(`/admin/risk-rules/${code}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        showToast('规则已更新，即时生效', 'success')
        close()
        await load()
      } catch (e) {
        showToast(e.message || '操作失败', 'error')
      }
    }
  }

  window.toggleRiskRule = async (code, enabled) => {
    if (!confirm(`确定${enabled ? '启用' : '停用'}该规则吗？`)) return
    try {
      await adminApi(`/admin/risk-rules/${code}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      showToast(enabled ? '已启用' : '已停用', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  try {
    await load()
  } catch (e) {
    document.getElementById('ruleList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
  }
}

// ========== 支付渠道配置 ==========
async function renderAdminChannels() {
  app.innerHTML = `
    ${renderAdminNav('adminChannels')}
    <div class="page">
      <div class="card">
        <h3>支付渠道管理</h3>
        <p style="color:#999;margin:8px 0 16px">配置微信支付、支付宝等支付渠道的密钥和证书。未配置的渠道将使用模拟支付。</p>
        <button onclick="showAddChannel()" style="margin-bottom:12px">添加渠道</button>
        <div id="channelList"><div class="empty">加载中...</div></div>
      </div>
    </div>
  `
  bindAdminNav()

  const channelTemplates = {
    wechat: {
      name: '微信支付',
      type: 'BOTH',
      fields: [
        { key: 'appid', label: '应用AppID', placeholder: 'wx1234567890abcdef' },
        { key: 'mchid', label: '商户号', placeholder: '1234567890' },
        { key: 'serialNo', label: '证书序列号', placeholder: '从商户平台获取' },
        { key: 'privateKey', label: '商户API私钥', placeholder: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----', type: 'textarea' },
        { key: 'apiV3Key', label: 'APIv3密钥', placeholder: '32位密钥' },
        { key: 'notifyUrl', label: '回调通知地址', placeholder: 'https://your-domain.com/webhooks/recharge/wechat' },
      ]
    },
    alipay: {
      name: '支付宝',
      type: 'BOTH',
      fields: [
        { key: 'appId', label: '应用AppID', placeholder: '2021001234567890' },
        { key: 'privateKey', label: '应用私钥', placeholder: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----', type: 'textarea' },
        { key: 'alipayPublicKey', label: '支付宝公钥', placeholder: 'MIIBIjANBgkqhk...' },
        { key: 'notifyUrl', label: '异步通知地址', placeholder: 'https://your-domain.com/webhooks/recharge/alipay' },
        { key: 'returnUrl', label: '同步跳转地址', placeholder: 'https://your-domain.com/payment/result' },
      ]
    }
  }

  async function load() {
    try {
      const channels = await adminApi('/admin/channels')
      const list = document.getElementById('channelList')
      if (!channels.length) {
        list.innerHTML = `<div class="empty">暂未配置支付渠道。<br><small>点击"添加渠道"开始配置微信支付或支付宝。</small></div>`
        return
      }
      list.innerHTML = channels.map(ch => `
        <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:8px;position:relative">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <strong>${ch.name}</strong> <span style="color:#666;font-size:13px">(${ch.code})</span>
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:8px;
                background:${ch.enabled ? '#e6f7e6' : '#fff3e0'};color:${ch.enabled ? '#16a34a' : '#e67e22'}">
                ${ch.enabled ? '已启用' : '未启用'}
              </span>
            </div>
            <div>
              <button onclick="editChannel('${ch.code}')" style="margin-right:4px">编辑</button>
              <button onclick="toggleChannel('${ch.code}', ${!ch.enabled})" style="background:${ch.enabled ? '#e67e22' : '#16a34a'}">
                ${ch.enabled ? '停用' : '启用'}
              </button>
              <button onclick="deleteChannel('${ch.code}')" style="background:#e74c3c;margin-left:4px">删除</button>
            </div>
          </div>
          <div style="margin-top:8px;font-size:13px;color:#666">
            已配置: ${ch.config !== '{}' ? Object.keys(JSON.parse(ch.config)).join(', ') : '无'}
          </div>
        </div>
      `).join('')
    } catch (e) {
      document.getElementById('channelList').innerHTML = `<div class="empty">加载失败：${e.message}</div>`
    }
  }

  window.showAddChannel = () => {
    const options = Object.entries(channelTemplates).map(([code, t]) =>
      `<option value="${code}">${t.name}</option>`
    ).join('')
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <h3>添加支付渠道</h3>
        <div class="form-group">
          <label>选择渠道</label>
          <select id="addChannelCode" onchange="onAddChannelChange()">
            ${options}
          </select>
        </div>
        <div id="addChannelFields"></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button onclick="doAddChannel()">保存</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    onAddChannelChange()
  }

  window.onAddChannelChange = () => {
    const code = document.getElementById('addChannelCode')?.value
    const tmpl = channelTemplates[code]
    if (!tmpl) return
    document.getElementById('addChannelFields').innerHTML = tmpl.fields.map(f => `
      <div class="form-group">
        <label>${f.label}</label>
        ${f.type === 'textarea'
          ? `<textarea id="ch_${f.key}" placeholder="${f.placeholder || ''}" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px"></textarea>`
          : `<input type="text" id="ch_${f.key}" placeholder="${f.placeholder || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px">`
        }
      </div>
    `).join('')
  }

  window.doAddChannel = async () => {
    const code = document.getElementById('addChannelCode').value
    const tmpl = channelTemplates[code]
    const config = {}
    for (const f of tmpl.fields) {
      const val = document.getElementById(`ch_${f.key}`)?.value?.trim()
      if (val) config[f.key] = val
    }
    try {
      await adminApi('/admin/channels', {
        method: 'POST',
        body: JSON.stringify({
          code,
          name: tmpl.name,
          type: tmpl.type,
          enabled: false,
          priority: 0,
          config: JSON.stringify(config),
        }),
      })
      document.querySelector('.modal-overlay')?.remove()
      showToast('渠道已添加，请填写密钥后启用', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.editChannel = async (code) => {
    const channels = await adminApi('/admin/channels')
    const ch = channels.find(c => c.code === code)
    if (!ch) return
    const tmpl = channelTemplates[code]
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <h3>编辑 ${ch.name}</h3>
        ${tmpl ? tmpl.fields.map(f => {
          let currentVal = ''
          try {
            const cfg = JSON.parse(ch.config)
            currentVal = cfg[f.key] || ''
          } catch {}
          return `
            <div class="form-group">
              <label>${f.label}</label>
              ${f.type === 'textarea'
                ? `<textarea id="ch_${f.key}" placeholder="${f.placeholder || ''}" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px">${currentVal}</textarea>`
                : `<input type="text" id="ch_${f.key}" value="${currentVal}" placeholder="${f.placeholder || ''}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px">`
              }
            </div>
          `
        }).join('') : '<p>自定义配置 (JSON)</p><textarea id="ch_rawConfig" rows="6" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px">' + ch.config + '</textarea>'}
        <div class="form-group">
          <label>优先级 (数字越大优先级越高)</label>
          <input type="number" id="ch_priority" value="${ch.priority}" min="0">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button onclick="doEditChannel('${code}')">保存</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
  }

  window.doEditChannel = async (code) => {
    const tmpl = channelTemplates[code]
    let configStr
    if (tmpl) {
      const config = {}
      for (const f of tmpl.fields) {
        const val = document.getElementById(`ch_${f.key}`)?.value?.trim()
        if (val) config[f.key] = val
      }
      configStr = JSON.stringify(config)
    } else {
      configStr = document.getElementById('ch_rawConfig')?.value || '{}'
    }
    const priority = Number(document.getElementById('ch_priority')?.value || 0)
    try {
      await adminApi(`/admin/channels/${code}`, {
        method: 'PUT',
        body: JSON.stringify({ config: configStr, priority }),
      })
      document.querySelector('.modal-overlay')?.remove()
      showToast('已保存', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.toggleChannel = async (code, enabled) => {
    if (!confirm(`确定${enabled ? '启用' : '停用'}该渠道吗？`)) return
    try {
      await adminApi(`/admin/channels/${code}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      showToast(enabled ? '已启用' : '已停用', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  window.deleteChannel = async (code) => {
    if (!confirm('确定删除该渠道配置吗？')) return
    try {
      await adminApi(`/admin/channels/${code}`, { method: 'DELETE' })
      showToast('已删除', 'success')
      await load()
    } catch (e) {
      showToast(e.message || '操作失败', 'error')
    }
  }

  await load()
}

// 银行卡管理页
async function renderBankCards() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0 0 100px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-bankcards-header{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
        .kb-bankcards-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)}
        .kb-bankcards-header .kb-back:active{background:var(--kb-border)}
        .kb-bankcards-header .kb-title{font-size:17px;font-weight:600;color:var(--kb-text)}
        .kb-bankcards-add{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-primary)}
        .kb-bankcards-content{padding:16px}
        .kb-bankcards-list{display:flex;flex-direction:column;gap:12px}
        .kb-bank-card{background:linear-gradient(135deg,var(--kb-primary) 0%,var(--kb-primary-light) 100%);border-radius:16px;padding:20px;color:#fff;box-shadow:0 4px 16px rgba(24,118,242,0.2);position:relative;overflow:hidden}
        .kb-bank-card::before{content:'';position:absolute;top:-40px;right:-40px;width:140px;height:140px;background:radial-gradient(circle,rgba(255,255,255,0.15) 0%,rgba(255,255,255,0) 65%);border-radius:50%}
        .kb-bank-card-head{display:flex;align-items:center;gap:12px;margin-bottom:24px;position:relative;z-index:1}
        .kb-bank-card-logo{width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center}
        .kb-bank-card-name{font-size:16px;font-weight:600}
        .kb-bank-card-type{font-size:12px;opacity:0.8;margin-top:2px}
        .kb-bank-card-num{font-size:18px;letter-spacing:3px;font-weight:500;font-family:monospace;margin-bottom:16px;position:relative;z-index:1}
        .kb-bank-card-foot{display:flex;justify-content:space-between;align-items:flex-end;position:relative;z-index:1}
        .kb-bank-card-holder{font-size:13px;opacity:0.9}
        .kb-bank-card-remove{background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;cursor:pointer}
        .kb-bank-card-remove:active{background:rgba(255,255,255,0.3)}
        .kb-bankcards-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;text-align:center}
        .kb-bankcards-empty-icon{width:80px;height:80px;border-radius:50%;background:var(--kb-bg-elevated);display:flex;align-items:center;justify-content:center;margin-bottom:16px;color:var(--kb-text-tertiary)}
        .kb-bankcards-empty-text{font-size:14px;color:var(--kb-text-secondary);margin-bottom:20px}
      </style>
      <div class="kb-bankcards-header">
        <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
        <div class="kb-title">我的银行卡</div>
        <button class="kb-bankcards-add" id="btnAddCard">${icon('plus', 20)}</button>
      </div>
      <div class="kb-bankcards-content" id="cardList">
        <div class="kb-bankcards-empty"><div class="kb-bankcards-empty-icon">${icon('empty', 40)}</div><div class="kb-bankcards-empty-text">加载中...</div></div>
      </div>
    </div>
  `
  document.getElementById('btnAddCard').onclick = () => {
    app.innerHTML = `
      <div class="page" style="padding:0 0 24px 0;background:var(--kb-bg);min-height:100vh">
        <style>
          .kb-addbank-header{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;background:#fff;border-bottom:1px solid var(--kb-border-light)}
          .kb-addbank-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:var(--kb-bg-elevated);color:var(--kb-text)}
          .kb-addbank-header .kb-title{font-size:17px;font-weight:600;color:var(--kb-text)}
          .kb-addbank-header .kb-placeholder{width:32px}
          .kb-addbank-card{background:#fff;border-radius:16px;margin:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)}
        </style>
        <div class="kb-addbank-header">
          <button class="kb-back" onclick="renderBankCards()">${icon('back', 18)}</button>
          <div class="kb-title">添加银行卡</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-addbank-card">
          <div class="form-group">
            <label class="form-label">持卡人姓名</label>
            <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('user',18)}</span><input class="form-input" id="cardHolder" placeholder="请输入持卡人姓名" style="padding-left:42px"></div>
          </div>
          <div class="form-group">
            <label class="form-label">银行卡号</label>
            <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('card',18)}</span><input class="form-input" id="cardNumber" placeholder="请输入银行卡号" maxlength="23" style="padding-left:42px"></div>
          </div>
          <div class="form-group">
            <label class="form-label">银行名称</label>
            <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('bank',18)}</span><input class="form-input" id="bankName" placeholder="请输入银行名称（如：工商银行）" style="padding-left:42px"></div>
          </div>
          <div class="form-group">
            <label class="form-label">支行名称（选填）</label>
            <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('bank',18)}</span><input class="form-input" id="branchName" placeholder="请输入支行名称" style="padding-left:42px"></div>
          </div>
          <div class="form-group">
            <label class="form-label">预留手机号</label>
            <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--kb-text-tertiary);pointer-events:none;display:flex;align-items:center">${icon('phone',18)}</span><input class="form-input" id="bankPhone" placeholder="请输入银行预留手机号" maxlength="11" style="padding-left:42px"></div>
          </div>
          <button class="btn btn-primary" id="btnSaveCard" style="height:50px;font-size:16px;font-weight:600">确认添加</button>
        </div>
      </div>
    `
    const cardNumInput = document.getElementById('cardNumber')
    cardNumInput.oninput = () => {
      const v = cardNumInput.value.replace(/\s/g, '').replace(/\D/g, '')
      cardNumInput.value = v.replace(/(.{4})/g, '$1 ').trim()
    }
    document.getElementById('btnSaveCard').onclick = async () => {
      try {
        const holder = document.getElementById('cardHolder').value.trim()
        const number = document.getElementById('cardNumber').value.replace(/\s/g, '')
        const bank = document.getElementById('bankName').value.trim()
        const branch = document.getElementById('branchName').value.trim()
        const phone = document.getElementById('bankPhone').value.trim()
        if (!holder) return showToast('请输入持卡人姓名')
        if (!number || number.length < 16) return showToast('请输入正确的银行卡号')
        if (!bank) return showToast('请输入银行名称')
        if (!/^1\d{10}$/.test(phone)) return showToast('请输入正确的手机号')
        await api('/bank-cards', { body: { holderName: holder, cardNumber: number, bankName: bank, branchName: branch, phone } })
        showToast('添加成功', 'success')
        renderBankCards()
      } catch (e) {
        showToast(e.message || '操作失败', 'error')
      }
    }
  }
  try {
    const cards = await api('/bank-cards')
    const list = Array.isArray(cards) ? cards : (cards.data || [])
    const container = document.getElementById('cardList')
    if (list.length === 0) {
      container.innerHTML = `
        <div class="kb-bankcards-empty">
          <div class="kb-bankcards-empty-icon">${icon('card', 40)}</div>
          <div class="kb-bankcards-empty-text">暂无银行卡，点击右上角添加</div>
        </div>
      `
    } else {
      container.innerHTML = `<div class="kb-bankcards-list">${list.map((c) => `
        <div class="kb-bank-card">
          <div class="kb-bank-card-head">
            <div class="kb-bank-card-logo">${icon('bank', 22)}</div>
            <div>
              <div class="kb-bank-card-name">${c.bankName || '银行卡'}</div>
              <div class="kb-bank-card-type">储蓄卡</div>
            </div>
          </div>
          <div class="kb-bank-card-num">${c.cardNumber ? '**** **** **** ' + c.cardNumber.slice(-4) : '**** **** **** ****'}</div>
          <div class="kb-bank-card-foot">
            <div class="kb-bank-card-holder">${c.holderName || ''}</div>
            <button class="kb-bank-card-remove" onclick="removeCard('${c.id}')">解除绑定</button>
          </div>
        </div>
      `).join('')}</div>`
    }
  } catch (e) {
    document.getElementById('cardList').innerHTML = `
      <div class="kb-bankcards-empty">
        <div class="kb-bankcards-empty-icon">${icon('empty', 40)}</div>
        <div class="kb-bankcards-empty-text">加载失败：${e.message}</div>
      </div>
    `
  }
}

window.removeCard = async (id) => {
  if (!confirm('确定解除绑定该银行卡吗？')) return
  try {
    await api(`/bank-cards/${id}`, { method: 'DELETE' })
    showToast('已解除绑定', 'success')
    renderBankCards()
  } catch (e) {
    showToast(e.message || '操作失败', 'error')
  }
}

// 帮助中心页
function renderHelp() {
  const faqs = [
    { q: '如何充值？', a: '在「我的钱包」页面点击「充值」，可通过绑定银行卡或支付宝/微信等渠道进行充值。' },
    { q: '如何提现？', a: '在「我的钱包」页面点击「提现」，需先绑定银行卡，输入提现金额和支付密码即可。提现通常在1-2个工作日到账。' },
    { q: '忘记支付密码怎么办？', a: '进入「安全中心」→「重置支付密码」，通过手机验证码即可重置支付密码。' },
    { q: '如何进行实名认证？', a: '在「我的」页面点击「实名认证」，输入真实姓名和身份证号即可完成认证，认证后才能使用全部功能。' },
    { q: '转账多久到账？', a: '科贝钱包内转账即时到账；银行卡转账通常在1-3个工作日内到账。' },
    { q: '红包有效期是多久？', a: '发送的红包24小时内未被领取，金额将自动退回原账户。' },
    { q: '收款码有有效期吗？', a: '个人收款码长期有效。商户收款码可在商户后台设置有效期。' },
    { q: '如何联系客服？', a: '您可通过以下方式联系我们：发送邮件至 support@kebaipay.com，工作时间周一至周日 9:00-21:00，我们会在1个工作日内回复。' }
  ]
  app.innerHTML = `
    <div class="page" style="padding:0 0 100px 0;background:var(--kb-bg);min-height:100vh">
      <style>
        .kb-help-hero{background:var(--kb-primary-gradient);padding:calc(var(--kb-safe-area-top) + 8px) 20px 64px;color:#fff;position:relative;overflow:hidden}
        .kb-help-hero::before{content:'';position:absolute;top:-50px;right:-30px;width:160px;height:160px;background:radial-gradient(circle,rgba(255,255,255,0.12) 0%,rgba(255,255,255,0) 65%);border-radius:50%;pointer-events:none}
        .kb-help-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;position:relative;z-index:1}
        .kb-help-header .kb-back{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(255,255,255,0.15);color:#fff}
        .kb-help-header .kb-back:active{background:rgba(255,255,255,0.25)}
        .kb-help-header .kb-title{font-size:17px;font-weight:600;color:#fff}
        .kb-help-header .kb-placeholder{width:32px}
        .kb-help-search{position:relative;z-index:1}
        .kb-help-search-box{display:flex;align-items:center;background:rgba(255,255,255,0.2);border-radius:24px;padding:10px 16px;gap:8px;backdrop-filter:blur(4px)}
        .kb-help-search-box input{flex:1;background:none;border:none;outline:none;color:#fff;font-size:14px}
        .kb-help-search-box input::placeholder{color:rgba(255,255,255,0.7)}
        .kb-help-search-box svg{color:rgba(255,255,255,0.7);flex-shrink:0}
        .kb-help-content{margin:-40px 16px 0;position:relative;z-index:2}
        .kb-help-quick{background:#fff;border-radius:16px;padding:16px;box-shadow:0 4px 16px rgba(0,0,0,0.06);margin-bottom:16px}
        .kb-help-quick-title{font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px;display:flex;align-items:center;gap:6px}
        .kb-help-quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        .kb-help-quick-item{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer}
        .kb-help-quick-icon{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center}
        .kb-help-quick-item span{font-size:12px;color:var(--kb-text-secondary)}
        .kb-help-faq{background:#fff;border-radius:16px;padding:8px 16px;box-shadow:0 4px 16px rgba(0,0,0,0.06)}
        .kb-help-faq-title{font-size:15px;font-weight:600;color:var(--kb-text);margin:12px 4px;display:flex;align-items:center;gap:6px}
        .kb-help-faq-item{border-bottom:1px solid var(--kb-border-light)}
        .kb-help-faq-item:last-child{border-bottom:none}
        .kb-help-faq-q{display:flex;align-items:center;justify-content:space-between;padding:14px 0;cursor:pointer;font-size:14px;color:var(--kb-text);font-weight:500;gap:8px}
        .kb-help-faq-q span{flex:1}
        .kb-help-faq-q .kb-arrow{transition:transform 0.3s;color:var(--kb-text-tertiary);flex-shrink:0}
        .kb-help-faq-item.open .kb-arrow{transform:rotate(90deg)}
        .kb-help-faq-a{max-height:0;overflow:hidden;transition:max-height 0.3s ease;font-size:13px;color:var(--kb-text-secondary);line-height:1.7}
        .kb-help-faq-item.open .kb-help-faq-a{max-height:200px;padding-bottom:14px}
        .kb-help-contact{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 16px rgba(0,0,0,0.06);margin-top:16px;text-align:center}
        .kb-help-contact-title{font-size:15px;font-weight:600;color:var(--kb-text);margin-bottom:12px}
        .kb-help-contact-row{display:flex;justify-content:center;gap:24px}
        .kb-help-contact-item{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer}
        .kb-help-contact-icon{width:48px;height:48px;border-radius:50%;background:var(--kb-primary-light);display:flex;align-items:center;justify-content:center;color:var(--kb-primary)}
        .kb-help-contact-item span{font-size:12px;color:var(--kb-text-secondary)}
      </style>
      <div class="kb-help-hero">
        <div class="kb-help-header">
          <button class="kb-back" onclick="history.back()">${icon('back', 18)}</button>
          <div class="kb-title">帮助中心</div>
          <div class="kb-placeholder"></div>
        </div>
        <div class="kb-help-search">
          <div class="kb-help-search-box">${icon('search', 18)}<input type="text" id="helpSearch" placeholder="搜索常见问题..."></div>
        </div>
      </div>
      <div class="kb-help-content">
        <div class="kb-help-quick">
          <div class="kb-help-quick-title">快捷入口</div>
          <div class="kb-help-quick-grid">
            <div class="kb-help-quick-item" onclick="navigate('wallet')"><div class="kb-help-quick-icon" style="background:#e6f4ff;color:#1890ff">${icon('wallet',22)}</div><span>充值提现</span></div>
            <div class="kb-help-quick-item" onclick="navigate('security')"><div class="kb-help-quick-icon" style="background:#f6ffed;color:#52c41a">${icon('lock',22)}</div><span>账户安全</span></div>
            <div class="kb-help-quick-item" onclick="navigate('identity')"><div class="kb-help-quick-icon" style="background:#fff7e6;color:#faad14">${icon('idCard',22)}</div><span>实名认证</span></div>
            <div class="kb-help-quick-item" onclick="navigate('redpacket')"><div class="kb-help-quick-icon" style="background:#fff1f0;color:#ff4d4f">${icon('redpacket',22)}</div><span>红包问题</span></div>
          </div>
        </div>
        <div class="kb-help-faq">
          <div class="kb-help-faq-title">${icon('help',16,'var(--kb-primary)')} 常见问题</div>
          ${faqs.map((f, i) => `
            <div class="kb-help-faq-item" data-idx="${i}">
              <div class="kb-help-faq-q"><span>${f.q}</span><span class="kb-arrow">${icon('chevronRight',14)}</span></div>
              <div class="kb-help-faq-a">${f.a}</div>
            </div>
          `).join('')}
        </div>
        <div class="kb-help-contact">
          <div class="kb-help-contact-title">联系我们</div>
          <div class="kb-help-contact-row">
            <div class="kb-help-contact-item"><div class="kb-help-contact-icon">${icon('phone',22)}</div><span>客服热线</span></div>
            <div class="kb-help-contact-item"><div class="kb-help-contact-icon" style="background:#f6ffed;color:#52c41a">${icon('mail',22)}</div><span>邮件反馈</span></div>
          </div>
        </div>
      </div>
    </div>
  `
  document.querySelectorAll('.kb-help-faq-q').forEach(el => {
    el.onclick = () => el.parentElement.classList.toggle('open')
  })
  document.getElementById('helpSearch').oninput = (e) => {
    const kw = e.target.value.trim().toLowerCase()
    document.querySelectorAll('.kb-help-faq-item').forEach(item => {
      const q = item.querySelector('.kb-help-faq-q span').textContent.toLowerCase()
      const a = item.querySelector('.kb-help-faq-a').textContent.toLowerCase()
      item.style.display = (!kw || q.includes(kw) || a.includes(kw)) ? '' : 'none'
    })
  }
}

// 扫一扫页
function renderScan() {
  if (!token) return navigate('login')
  app.innerHTML = `
    <div class="page" style="padding:0;background:#000;min-height:100vh;position:relative;overflow:hidden">
      <style>
        .kb-scan-header{display:flex;align-items:center;justify-content:space-between;padding:calc(var(--kb-safe-area-top) + 8px) 16px 12px;position:absolute;top:0;left:0;right:0;z-index:10}
        .kb-scan-header .kb-back{width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;transition:background 0.2s;border:none;background:rgba(0,0,0,0.4);color:#fff;backdrop-filter:blur(4px)}
        .kb-scan-header .kb-title{font-size:17px;font-weight:600;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.5)}
        .kb-scan-header .kb-placeholder{width:36px}
        .kb-scan-viewport{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .kb-scan-frame{width:260px;height:260px;position:relative;border:2px solid rgba(255,255,255,0.3);border-radius:16px;overflow:hidden}
        .kb-scan-frame::before,.kb-scan-frame::after{content:'';position:absolute;width:24px;height:24px;border-color:#1890ff;border-style:solid}
        .kb-scan-frame::before{top:-2px;left:-2px;border-width:3px 0 0 3px;border-top-left-radius:16px}
        .kb-scan-frame::after{bottom:-2px;right:-2px;border-width:0 3px 3px 0;border-bottom-right-radius:16px}
        .kb-scan-corner-bl,.kb-scan-corner-tr{position:absolute;width:24px;height:24px;border-color:#1890ff;border-style:solid}
        .kb-scan-corner-bl{bottom:-2px;left:-2px;border-width:0 0 3px 3px;border-bottom-left-radius:16px}
        .kb-scan-corner-tr{top:-2px;right:-2px;border-width:3px 3px 0 0;border-top-right-radius:16px}
        .kb-scan-line{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#1890ff,transparent);animation:kbScanLine 2.5s ease-in-out infinite;box-shadow:0 0 8px #1890ff}
        @keyframes kbScanLine{0%{top:0}50%{top:calc(100% - 2px)}100%{top:0}}
        .kb-scan-mask{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:-1}
        .kb-scan-mask::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:260px;height:260px;border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,0.55)}
        .kb-scan-hint{position:absolute;top:calc(50% + 160px);left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.8);font-size:14px;text-align:center;text-shadow:0 1px 4px rgba(0,0,0,0.5);white-space:nowrap}
        .kb-scan-input{position:absolute;bottom:120px;left:16px;right:16px;display:flex;gap:8px;z-index:10}
        .kb-scan-input input{flex:1;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);border-radius:24px;padding:10px 16px;color:#fff;font-size:14px;outline:none;backdrop-filter:blur(4px)}
        .kb-scan-input input::placeholder{color:rgba(255,255,255,0.5)}
        .kb-scan-input button{background:var(--kb-primary-gradient);border:none;color:#fff;padding:10px 20px;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
        .kb-scan-actions{position:absolute;bottom:40px;left:0;right:0;display:flex;justify-content:center;gap:40px;z-index:10}
        .kb-scan-action{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;color:rgba(255,255,255,0.8);background:none;border:none}
        .kb-scan-action-icon{width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);transition:background 0.2s}
        .kb-scan-action:active .kb-scan-action-icon{background:rgba(255,255,255,0.25)}
        .kb-scan-action span{font-size:12px}
      </style>
      <div class="kb-scan-header">
        <button class="kb-back" onclick="history.back()">${icon('close', 20)}</button>
        <div class="kb-title">扫一扫</div>
        <div class="kb-placeholder"></div>
      </div>
      <div class="kb-scan-viewport">
        <div class="kb-scan-mask"></div>
        <div class="kb-scan-frame">
          <div class="kb-scan-corner-bl"></div>
          <div class="kb-scan-corner-tr"></div>
          <div class="kb-scan-line"></div>
        </div>
        <div class="kb-scan-hint">将二维码/条码放入框内，即可自动扫描</div>
      </div>
      <div class="kb-scan-input">
        <input type="text" id="qrInput" placeholder="或手动输入付款码/收款码内容">
        <button id="btnQrGo">识别</button>
      </div>
      <div class="kb-scan-actions">
        <button class="kb-scan-action" onclick="navigate('qrcode')"><div class="kb-scan-action-icon">${icon('qrcode',24)}</div><span>我的收款码</span></button>
        <button class="kb-scan-action"><div class="kb-scan-action-icon">${icon('bill',24)}</div><span>扫码记录</span></button>
      </div>
    </div>
  `
  document.getElementById('btnQrGo').onclick = () => {
    const text = document.getElementById('qrInput').value.trim()
    if (!text) return showToast('请输入二维码内容')
    try {
      const url = new URL(text)
      const hash = url.hash.replace('#', '')
      const page = hash.split('?')[0]
      if (page === 'cashier' || page === 'payByQr' || page === 'transfer') {
        window.location.hash = hash
        return
      }
    } catch {}
    showToast('无效的二维码内容：' + text, 'error')
  }
}
