import { Injectable, Logger } from '@nestjs/common'
import { MailerService } from '@nestjs-modules/mailer'
import { ConfigService } from '@nestjs/config'

export interface NotifyEmailOpts {
  to: string
  subject: string
  html: string
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
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - 支付成功通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#10b981">支付成功</h2>
          <p>您的订单已支付成功：</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">订单号</td><td style="padding:8px;font-weight:600">${orderNo}</td></tr>
            <tr><td style="padding:8px;color:#666">商品</td><td style="padding:8px">${subject}</td></tr>
            <tr><td style="padding:8px;color:#666">金额</td><td style="padding:8px;font-size:18px;color:#ef4444;font-weight:600">¥${amountYuan}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">如有疑问请联系客服。</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }

  async notifyRechargeSuccess(email: string, amountYuan: string, channel: string) {
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - 充值成功通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#10b981">充值成功</h2>
          <p>您的账户已成功充值：</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">金额</td><td style="padding:8px;font-size:18px;color:#10b981;font-weight:600">+¥${amountYuan}</td></tr>
            <tr><td style="padding:8px;color:#666">渠道</td><td style="padding:8px">${channel}</td></tr>
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
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - ${label}通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:${color}">${label}</h2>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">金额</td><td style="padding:8px;font-size:18px;font-weight:600">¥${amountYuan}</td></tr>
            <tr><td style="padding:8px;color:#666">状态</td><td style="padding:8px;color:${color}">${label}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }

  async notifySettlementComplete(email: string, merchantName: string, amountYuan: string, settleDate: string) {
    return this.sendEmail({
      to: email,
      subject: `KeBaiPay - 结算到账通知`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#10b981">结算到账</h2>
          <p>商户 <strong>${merchantName}</strong> 的 T+1 结算已处理：</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">结算日期</td><td style="padding:8px">${settleDate}</td></tr>
            <tr><td style="padding:8px;color:#666">结算金额</td><td style="padding:8px;font-size:18px;color:#10b981;font-weight:600">¥${amountYuan}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">资金将在1-2个工作日内到达您的结算账户。</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">KeBaiPay 科佰支付</p>
        </div>
      `,
    })
  }
}
