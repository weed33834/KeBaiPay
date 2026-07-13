import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  RedPacketStatus,
  RedPacketRecordType,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  UserStatus,
  RiskLevel,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { DEFAULT_RED_PACKET_DAILY_LIMIT_CENTS, RED_PACKET_EXPIRY_MS, REDIS_LOCK_TTL_SECONDS } from '../common/constants'

@Injectable()
export class RedPacketsService {
  private readonly logger = new Logger(RedPacketsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  async create(
    senderId: string,
    dto: { amount: number; remark?: string; payPassword: string; idempotencyKey?: string },
  )
  {
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_AMOUNT_INVALID))
    }

    const sender = await this.usersService.findById(senderId)
    if (!sender) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (sender.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (
      sender.status === UserStatus.FROZEN ||
      sender.status === UserStatus.EXPENSE_RESTRICTED
    ) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户状态异常，无法发红包'))
    }
    if (sender.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '高风险用户无法发红包'))
    }
    await this.usersService.verifyPayPassword(senderId, dto.payPassword)

    const amount = yuanToFen(dto.amount)

    // 风控检查：发红包前检查发送方
    const riskResult = await this.riskEngine.check({
      userId: senderId,
      type: 'RED_PACKET',
      amount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `发红包被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
        ),
      )
    }

    return this.redis.withLock(
      `redpacket:create:${senderId}`,
      REDIS_LOCK_TTL_SECONDS,
      async () => this.prisma.$transaction(async (tx) => {
      // 幂等键预检查：同一 idempotencyKey 命中已存在红包时直接返回，避免网络重试创建第二个红包
      if (dto.idempotencyKey) {
        const existing = await tx.redPacket.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        })
        if (existing) {
          // 校验归属，防止不同用户使用相同 idempotencyKey 获取他人红包
          if (existing.senderId !== senderId) {
            throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
          }
          return existing
        }
      }

      // 单日发红包限额：从 systemConfig 读取（单位元），默认 DEFAULT_RED_PACKET_DAILY_LIMIT_CENTS
      const dateStr = new Date().toISOString().slice(0, 10)
      const limitConfig = await tx.systemConfig.findUnique({
        where: { key: 'red_packet_daily_limit' },
      })
      const redPacketLimit = limitConfig
        ? Math.round(Number(limitConfig.value) * 100)
        : DEFAULT_RED_PACKET_DAILY_LIMIT_CENTS
      await this.usersService.checkAndIncrementDailyLimit(
        tx,
        senderId,
        'RED_PACKET',
        dateStr,
        amount,
        redPacketLimit,
      )

      const account = await tx.account.findUnique({ where: { userId: senderId } })
      if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
      if (account.availableBalance < amount) {
        throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
      }

      const packetNo = generateOrderNo('RP')
      const expiresAt = new Date(Date.now() + RED_PACKET_EXPIRY_MS)

      const packet = await tx.redPacket.create({
        data: {
          packetNo,
          senderId,
          amount,
          status: RedPacketStatus.PENDING,
          remark: dto.remark,
          expiresAt,
          idempotencyKey: dto.idempotencyKey,
        },
      })

      const deductResult = await tx.account.updateMany({
        where: {
          id: account.id,
          availableBalance: { gte: amount },
        },
        data: {
          availableBalance: { decrement: amount },
          frozenBalance: { increment: amount },
        },
      })
      if (deductResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
      }

      const updatedAccount = await tx.account.findUnique({
        where: { id: account.id },
      })

      // H1: balanceAfter 取重新读取的真实余额，balanceBefore = balanceAfter + amount（扣款前）
      const rpBalanceAfter = updatedAccount!.availableBalance
      const rpBalanceBefore = rpBalanceAfter + amount

      await tx.accountLedger.create({
        data: {
          accountId: account.id,
          transactionId: packet.id,
          type: LedgerType.RED_PACKET,
          amount,
          balanceBefore: rpBalanceBefore,
          balanceAfter: rpBalanceAfter,
          direction: Direction.CREDIT,
          remark: '发出红包',
        },
      })

      return packet
      }),
    ).then((packet) => {
      // 发红包成功后记录风控频率（不阻塞业务）
      this.riskEngine.recordTransaction({
        userId: senderId,
        type: 'RED_PACKET',
        amount,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(RED_PACKET create) 失败: ${err?.message || err}`)
      })
      return packet
    })
  }

  async receive(receiverId: string, packetNo: string, idempotencyKey?: string) {
    const receiver = await this.usersService.findById(receiverId)
    if (!receiver) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (receiver.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (
      receiver.status === UserStatus.FROZEN ||
      receiver.status === UserStatus.INCOME_RESTRICTED
    ) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户状态异常，无法领取红包'))
    }

    return this.redis.withLock(
      `redpacket:receive:${packetNo}`,
      REDIS_LOCK_TTL_SECONDS,
      async () => this.prisma.$transaction(async (tx) => {
      const packet = await tx.redPacket.findUnique({
        where: { packetNo },
        // 仅加载 nickname 用于账单 counterparty，避免泄露 sender 的密码哈希/手机号/身份证等 PII
        include: { sender: { select: { nickname: true } } },
      })
      if (!packet) throw new NotFoundException(kbError(KBErrorCodes.RED_PACKET_NOT_FOUND))

      // 幂等返回：当前用户已领取过该红包时直接返回已领取记录，避免网络超时重试时
      // 第二次抛 RED_PACKET_CLAIMED_OR_EXPIRED，用户不知道其实已领取成功
      const existingRecord = await tx.redPacketRecord.findFirst({
        where: {
          redPacketId: packet.id,
          receiverId,
          type: RedPacketRecordType.RECEIVE,
        },
      })
      if (existingRecord) return existingRecord

      if (packet.status !== RedPacketStatus.PENDING) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIMED_OR_EXPIRED))
      }
      if (packet.senderId === receiverId) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIM_SELF))
      }
      if (packet.expiresAt < new Date()) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_EXPIRED))
      }

      // 风控检查：领取前检查收款方
      const riskResult = await this.riskEngine.check({
        userId: receiverId,
        type: 'RED_PACKET',
        amount: packet.amount,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `领取红包被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
          ),
        )
      }

      // 乐观锁：仅当仍为 PENDING 时才标记为已领取，避免并发双领
      const claimResult = await tx.redPacket.updateMany({
        where: { id: packet.id, status: RedPacketStatus.PENDING },
        data: {
          status: RedPacketStatus.RECEIVED,
          receivedAt: new Date(),
        },
      })
      if (claimResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIMED_OR_EXPIRED))
      }

      const receiverAccount = await tx.account.findUnique({
        where: { userId: receiverId },
      })
      if (!receiverAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '收款账户不存在'))

      const updatedReceiver = await tx.account.update({
        where: { id: receiverAccount.id },
        data: {
          availableBalance: { increment: packet.amount },
          totalBalance: { increment: packet.amount },
        },
      })

      const senderAccount = await tx.account.findUnique({
        where: { userId: packet.senderId },
      })
      if (!senderAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '发红包账户不存在'))

      const releaseResult = await tx.account.updateMany({
        where: {
          id: senderAccount.id,
          frozenBalance: { gte: packet.amount },
        },
        data: {
          frozenBalance: { decrement: packet.amount },
          totalBalance: { decrement: packet.amount },
        },
      })
      if (releaseResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_STATUS_CHANGED))
      }

      const updatedSender = await tx.account.findUnique({
        where: { id: senderAccount.id },
      })

      await tx.redPacketRecord.create({
        data: {
          redPacketId: packet.id,
          receiverId,
          amount: packet.amount,
          type: RedPacketRecordType.RECEIVE,
        },
      })

      await tx.accountLedger.create({
        data: {
          accountId: senderAccount.id,
          transactionId: packet.id,
          type: LedgerType.RED_PACKET,
          amount: packet.amount,
          // H1: balanceAfter 取重新读取的真实冻结余额，balanceBefore = balanceAfter + amount（冻结扣减前）
          balanceBefore: updatedSender!.frozenBalance + packet.amount,
          balanceAfter: updatedSender!.frozenBalance,
          direction: Direction.CREDIT,
          remark: `红包被 ${receiver.nickname} 领取`,
        },
      })

      await tx.accountLedger.create({
        data: {
          accountId: receiverAccount.id,
          transactionId: packet.id,
          type: LedgerType.RED_PACKET,
          amount: packet.amount,
          // H1: balanceAfter 取 update 返回的真实余额，balanceBefore = balanceAfter - amount（加款前）
          balanceBefore: updatedReceiver.availableBalance - packet.amount,
          balanceAfter: updatedReceiver.availableBalance,
          direction: Direction.DEBIT,
          remark: `领取 ${packet.sender.nickname} 的红包`,
        },
      })

      await tx.bill.create({
        data: {
          userId: packet.senderId,
          transactionId: packet.id,
          type: BillType.RED_PACKET,
          direction: BillDirection.EXPENSE,
          amount: packet.amount,
          counterparty: receiver.nickname,
          remark: packet.remark || '红包',
        },
      })
      await tx.bill.create({
        data: {
          userId: receiverId,
          transactionId: packet.id,
          type: BillType.RED_PACKET,
          direction: BillDirection.INCOME,
          amount: packet.amount,
          counterparty: packet.sender.nickname,
          remark: packet.remark || '红包',
        },
      })

      return { ...packet, status: RedPacketStatus.RECEIVED, receivedAt: new Date() }
      }),
    ).then((result) => {
      // 领红包成功后记录风控频率（不阻塞业务）
      this.riskEngine.recordTransaction({
        userId: receiverId,
        type: 'RED_PACKET',
        amount: result.amount,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(RED_PACKET receive) 失败: ${err?.message || err}`)
      })
      return result
    })
  }

  async expireReturn(packetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const packet = await tx.redPacket.findUnique({
        where: { id: packetId },
      })
      if (!packet) throw new NotFoundException(kbError(KBErrorCodes.RED_PACKET_NOT_FOUND))
      if (packet.status !== RedPacketStatus.PENDING) return packet
      return this.returnPacket(tx, packet.id)
    })
  }

  private async returnPacket(tx: Prisma.TransactionClient, packetId: string) {
    // 乐观锁：仅当仍为 PENDING 时才标记为过期，避免并发领取后又被退回覆盖状态
    const lockResult = await tx.redPacket.updateMany({
      where: { id: packetId, status: RedPacketStatus.PENDING },
      data: {
        status: RedPacketStatus.EXPIRED,
        returnedAt: new Date(),
      },
    })
    if (lockResult.count === 0) {
      // 已被领取或已处理，跳过退回
      return
    }
    const packet = await tx.redPacket.findUnique({ where: { id: packetId } })
    if (!packet) return

    const account = await tx.account.findUnique({
      where: { userId: packet.senderId },
    })
    if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

    const returnResult = await tx.account.updateMany({
      where: {
        id: account.id,
        frozenBalance: { gte: packet.amount },
      },
      data: {
        availableBalance: { increment: packet.amount },
        frozenBalance: { decrement: packet.amount },
      },
    })
    if (returnResult.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_STATUS_CHANGED))
    }

    const updatedAccount = await tx.account.findUnique({
      where: { id: account.id },
    })

    await tx.redPacketRecord.create({
      data: {
        redPacketId: packet.id,
        receiverId: packet.senderId,
        amount: packet.amount,
        type: RedPacketRecordType.RETURN,
      },
    })

    await tx.accountLedger.create({
      data: {
        accountId: account.id,
        transactionId: packet.id,
        type: LedgerType.RED_PACKET,
        amount: packet.amount,
        // H1: balanceAfter 取重新读取的真实余额，balanceBefore = balanceAfter - amount（加款前）
        balanceBefore: updatedAccount!.availableBalance - packet.amount,
        balanceAfter: updatedAccount!.availableBalance,
        direction: Direction.DEBIT,
        remark: '红包过期退回',
      },
    })

    await tx.bill.create({
      data: {
        userId: packet.senderId,
        transactionId: packet.id,
        type: BillType.RED_PACKET,
        direction: BillDirection.INCOME,
        amount: packet.amount,
        remark: '红包过期退回',
      },
    })

    return packet
  }

  async findSent(userId: string) {
    return this.prisma.redPacket.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'desc' },
      include: { records: true },
    })
  }

  async findReceived(userId: string) {
    return this.prisma.redPacketRecord.findMany({
      where: { receiverId: userId, type: RedPacketRecordType.RECEIVE },
      orderBy: { createdAt: 'desc' },
      // 仅加载 sender.nickname，避免泄露密码哈希/手机号/身份证等 PII
      include: { redPacket: { include: { sender: { select: { nickname: true } } } } },
    })
  }

}
