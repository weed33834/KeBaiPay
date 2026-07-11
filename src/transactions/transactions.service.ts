import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { RiskEngineService } from '../risk/risk-engine.service'
import { JournalService } from '../finance/journal.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { REDIS_LOCK_TTL_SECONDS } from '../common/constants'

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly riskEngine: RiskEngineService,
    private readonly journalService: JournalService,
  ) {}

  /**
   * 发起充值
   *
   * 新流程：创建 PENDING 订单 → 调用渠道 → 返回支付参数
   * 实际到账由渠道回调 handleRechargeCallback 完成
   */
  async recharge(userId: string, amountYuan: number, payPassword: string, idempotencyKey?: string) {
    if (amountYuan <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.RECHARGE_AMOUNT_INVALID))
    }

    await this.usersService.verifyPayPassword(userId, payPassword)

    const amount = yuanToFen(amountYuan)
    const orderNo = generateOrderNo('R')

    // 幂等检查
    if (idempotencyKey) {
      const existing = await this.prisma.transactionOrder.findUnique({
        where: { idempotencyKey },
      })
      if (existing) return existing
    }

    // 风控检查：创建订单前执行，拦截高风险充值
    const riskResult = await this.riskEngine.check({
      userId,
      type: 'RECHARGE',
      amount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `充值被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
        ),
      )
    }

    // 获取充值渠道
    const channelEntry = await this.channelRegistry.getChannelByType('RECHARGE')
    if (!channelEntry) {
      throw new BadRequestException(kbError(KBErrorCodes.NO_RECHARGE_CHANNEL))
    }

    const { channel, config, code } = channelEntry

    // 创建 PENDING 订单（捕获 P2002 唯一约束冲突实现并发幂等：
    // 两个并发请求携带相同 idempotencyKey 都通过上方检查时，第二个 create 会触发 P2002，
    // 此时查回已建订单幂等返回，而非抛 500）
    let order
    try {
      order = await this.prisma.transactionOrder.create({
        data: {
          orderNo,
          type: TransactionType.RECHARGE,
          status: TransactionStatus.PENDING,
          amount,
          toUserId: userId,
          channel: code,
          idempotencyKey,
        },
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.transactionOrder.findUnique({
          where: { idempotencyKey },
        })
        if (existing) return existing
      }
      throw e
    }

    // 调用渠道发起支付
    const notifyUrl = process.env.RECHARGE_NOTIFY_URL || '/webhooks/recharge/mock'
    let rechargeResult
    try {
      rechargeResult = await channel.createRecharge({
        orderNo,
        amount,
        userId,
        subject: '余额充值',
        notifyUrl,
        channelConfig: config,
      })
    } catch (error) {
      // 渠道调用失败：标记订单 FAILED，避免订单卡死在 PENDING（无 channelOrderNo，
      // 后续回调会因渠道订单号不匹配被拒，订单将永久无法处理）
      await this.prisma.transactionOrder.update({
        where: { id: order.id },
        data: { status: TransactionStatus.FAILED, completedAt: new Date() },
      })
      throw new BadRequestException(
        kbError(
          KBErrorCodes.RECHARGE_CHANNEL_FAILED,
          `充值渠道调用失败：${error instanceof Error ? error.message : '未知错误'}`,
        ),
      )
    }

    // 保存渠道订单号（渠道调用成功后立即持久化，使回调可匹配）。
    // 注意：此处 update 与渠道调用不在同一事务内，存在崩溃窗口——若进程在渠道调用成功后、
    // 此处 update 前崩溃，订单将留 PENDING 且无 channelOrderNo。该窗口由两层兜底覆盖：
    // 1) handleRechargeCallback 在 channelOrderNo 为空时以验签后的回调 channelOrderNo 为准并补录；
    // 2) TransactionsSchedule 定时扫描超时 PENDING 订单告警，由人工/对账补单。
    await this.prisma.transactionOrder.update({
      where: { id: order.id },
      data: { channelOrderNo: rechargeResult.channelOrderNo },
    })

    return {
      orderNo,
      channelOrderNo: rechargeResult.channelOrderNo,
      status: rechargeResult.status,
      payUrl: rechargeResult.payUrl,
      payParams: rechargeResult.payParams,
    }
  }

  /**
   * 处理充值回调
   *
   * 由 Webhook 控制器调用，验签后入账
   */
  async handleRechargeCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const channel = this.channelRegistry.getChannel(channelCode)
    const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    const result = channel.parseRechargeCallback(rawBody, headers, channelConfig.config)

    return this.redis.withLock(`recharge:callback:${result.orderNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      return this.prisma.$transaction(async (tx) => {
        const order = await tx.transactionOrder.findUnique({
          where: { orderNo: result.orderNo },
        })
        if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '充值订单不存在'))
        if (order.status === TransactionStatus.SUCCESS || order.status === TransactionStatus.FAILED) {
          // 终态订单幂等返回，防止乱序回调凭空入账
          return channel.buildRechargeCallbackSuccess()
        }
        // 安全防护：回调渠道必须与订单创建时的渠道一致，防止用 A 渠道密钥伪造对 B 渠道订单的回调
        if (order.channel !== channelCode) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_MISMATCH))
        }
        // channelOrderNo 校验：正常情况下必须匹配。
        // 兜底：若订单 channelOrderNo 为空（渠道调用成功后、持久化 channelOrderNo 前进程崩溃），
        // 回调已经过 parseRechargeCallback 验签，此时以回调携带的 channelOrderNo 为准并补录，
        // 确保回调能匹配、订单不卡死在 PENDING（参考 H5 修复）。
        const channelOrderNoMissing = !order.channelOrderNo
        if (!channelOrderNoMissing && order.channelOrderNo !== result.channelOrderNo) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_ORDER_NO_MISMATCH))
        }

        if (result.status === 'FAILED') {
          await tx.transactionOrder.update({
            where: { id: order.id },
            data: {
              ...(channelOrderNoMissing ? { channelOrderNo: result.channelOrderNo } : {}),
              status: TransactionStatus.FAILED,
              completedAt: new Date(),
            },
          })
          return channel.buildRechargeCallbackSuccess()
        }

        // 成功：入账
        const account = await tx.account.findUnique({
          where: { userId: order.toUserId! },
        })
        if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

        const updatedAccount = await tx.account.update({
          where: { id: account.id },
          data: {
            availableBalance: { increment: order.amount },
            totalBalance: { increment: order.amount },
          },
        })

        await tx.transactionOrder.update({
          where: { id: order.id },
          data: {
            ...(channelOrderNoMissing ? { channelOrderNo: result.channelOrderNo } : {}),
            status: TransactionStatus.SUCCESS,
            completedAt: new Date(),
          },
        })

        await tx.accountLedger.create({
          data: {
            accountId: account.id,
            transactionId: order.id,
            type: LedgerType.RECHARGE,
            amount: order.amount,
            // H2: balanceBefore 由更新后真实余额反推，避免事务内并发导致陈旧读取
            balanceBefore: updatedAccount.availableBalance - order.amount,
            balanceAfter: updatedAccount.availableBalance,
            direction: Direction.DEBIT,
            remark: '余额充值',
          },
        })

        await tx.bill.create({
          data: {
            userId: order.toUserId!,
            transactionId: order.id,
            type: BillType.RECHARGE,
            direction: BillDirection.INCOME,
            amount: order.amount,
            remark: '余额充值',
          },
        })

        // 复式记账：借渠道资金=amount，贷用户=amount
        const journalId = generateOrderNo('J')
        await this.journalService.createEntries(tx, [
          { journalId, accountCode: 'CHANNEL_FUND', debit: order.amount, memo: `充值入账 ${order.orderNo}` },
          { journalId, accountCode: `USER:${order.toUserId}`, credit: order.amount, memo: `充值入账 ${order.orderNo}` },
        ])

        return channel.buildRechargeCallbackSuccess()
      })
    })
  }
}
