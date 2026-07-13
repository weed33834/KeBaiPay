import { Injectable, Logger } from '@nestjs/common'
import { MailerService } from '@nestjs-modules/mailer'
import { ConfigService } from '@nestjs/config'

export interface NotifyEmailOpts {
  to: string
  subject: string
  html: string
}

/**
 * HTML 实体转义：邮件 HTML 中插入用户可控变量前必须转义，
 * 防止订单号、商品名、商户名等字段被注入 <script> 或属性逃逸 HTML 结构。
 * 仅转义 OWASP 推荐的 5 个字符即可覆盖所有 HTML 注入向量。
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}
const HTML_ESCAPE_REGEX = /[&<>"']/g

function escapeHtml(value: unknown): string {
  return String(value).replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPE_MAP[ch])
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)
  private readonly smtpEnabled: boolean

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {
    this.smtpEnabled = !!this.config.get('SMTP_USER')
    if (!this.smtpEnabled) {
      this.logger.warn('SMTP_USER 未配置，邮件通知将仅记录日志不实际发送。')
    }
  }

  async sendEmail(opts: NotifyEmailOpts): Promise<boolean> {
    if (!this.smtpEnabled) {
      this.logger.log(`[邮件模拟] 收件人: ${opts.to}, 主题: ${opts.subject}`)
      return true
    }
    try {
      await this.mailer.sendMail({
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      })
      this.logger.log(`邮件发送成功: ${opts.to} - ${opts.subject}`)
      return true
    } catch (err) {
      this.logger.error(`邮件发送失败: ${opts.to}`, (err as Error).stack)
      return false
    }
  }

  async notifyPaymentSuccess(email: string, orderNo: string, amountYuan: string, subject: string) {
    // orderNo 系统生成理论上安全，但 subject 来自商户提交字段，必须转义
    const safeOrderNo = escapeHtml(orderNo)
    const safeSubject = escapeHtml(subject)
    const safeAmount = escapeHtml(amountYuan)
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - 支付成功通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#10b981">支付成功</h2>
          <p>您的订单已支付成功：</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">订单号</td><td style="padding:8px;font-weight:600">${safeOrderNo}</td></tr>
            <tr><td style="padding:8px;color:#666">商品</td><td style="padding:8px">${safeSubject}</td></tr>
            <tr><td style="padding:8px;color:#666">金额</td><td style="padding:8px;font-size:18px;color:#ef4444;font-weight:600">¥${safeAmount}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">如有疑问请联系客服。</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }

  async notifyRechargeSuccess(email: string, amountYuan: string, channel: string) {
    const safeAmount = escapeHtml(amountYuan)
    const safeChannel = escapeHtml(channel)
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - 充值成功通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#10b981">充值成功</h2>
          <p>您的账户已成功充值：</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">金额</td><td style="padding:8px;font-size:18px;color:#10b981;font-weight:600">+¥${safeAmount}</td></tr>
            <tr><td style="padding:8px;color:#666">渠道</td><td style="padding:8px">${safeChannel}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">请登录查看账户余额。</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }

  async notifyWithdrawResult(email: string, amountYuan: string, status: string) {
    const color = status === 'COMPLETED' ? '#10b981' : status === 'REJECTED' ? '#ef4444' : '#f59e0b'
    const label = status === 'COMPLETED' ? '提现成功' : status === 'REJECTED' ? '提现被拒绝' : '提现处理中'
    const safeAmount = escapeHtml(amountYuan)
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - ${label}通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:${color}">${label}</h2>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">金额</td><td style="padding:8px;font-size:18px;font-weight:600">¥${safeAmount}</td></tr>
            <tr><td style="padding:8px;color:#666">状态</td><td style="padding:8px;color:${color}">${label}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }

  async notifySettlementComplete(email: string, merchantName: string, amountYuan: string, settleDate: string) {
    // merchantName 由商户自己填写，必须转义防止注入邮件 HTML
    const safeMerchantName = escapeHtml(merchantName)
    const safeAmount = escapeHtml(amountYuan)
    const safeSettleDate = escapeHtml(settleDate)
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - 结算到账通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#10b981">结算到账</h2>
          <p>商户 <strong>${safeMerchantName}</strong> 的 T+1 结算已处理：</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">结算日期</td><td style="padding:8px">${safeSettleDate}</td></tr>
            <tr><td style="padding:8px;color:#666">结算金额</td><td style="padding:8px;font-size:18px;color:#10b981;font-weight:600">¥${safeAmount}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">资金将在1-2个工作日内到达您的结算账户。</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }
}
