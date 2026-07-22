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
  RedPacketType,
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
import { generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { DEFAULT_RED_PACKET_DAILY_LIMIT_CENTS, RED_PACKET_EXPIRY_MS, REDIS_LOCK_TTL_SECONDS } from '../common/constants'
import { CreateRedPacketDto } from './dto/create-red-packet.dto'

/**
 * 微信原生红包全协议服务
 *
 * 4 种红包类型：
 * - LUCKY：拼手气红包（金额随机分配，最低 0.01 元/人）
 * - ORDINARY：普通红包（每人固定金额 perAmount）
 * - EXCLUSIVE：专属红包（指定 designatedReceiverId 领取，totalCount=1）
 * - PASSWORD：口令红包（需输入 password 领取，totalCount=1）
 *
 * 兼容旧版：type 未指定时默认 LUCKY + totalCount=1
 *
 * 群红包状态：
 * - PENDING：待领取
 * - PARTIALLY_RECEIVED：部分被领取（0 < receivedCount < totalCount）
 * - RECEIVED：全部领取完
 * - EXPIRED：过期，剩余金额退回
 */
@Injectable()
export class RedPacketsService {
  private readonly logger = new Logger(RedPacketsService.name)

  // 单人领取金额上限（分）—— 微信现金红包协议上限 200 元，企业红包可更高
  private static readonly MAX_PER_CLAIM_CENTS = 200 * 100

  // 群红包总数量上限
  private static readonly MAX_TOTAL_COUNT = 100

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  async create(
    senderId: string,
    dto: CreateRedPacketDto,
  ) {
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

    const type = (dto.type || RedPacketType.LUCKY) as RedPacketType
    const totalCount = dto.totalCount ?? 1
    const amountFen = yuanToFen(dto.amount)
    const perAmountFen = dto.perAmount !== undefined ? yuanToFen(dto.perAmount) : null

    // 校验红包协议特定约束
    this.validateCreatePayload(type, totalCount, amountFen, perAmountFen, dto)

    // 校验 designatedReceiverId 真实存在（EXCLUSIVE 类型）
    if (type === RedPacketType.EXCLUSIVE && dto.designatedReceiverId) {
      const payee = await this.usersService.findById(dto.designatedReceiverId)
      if (!payee) {
        throw new NotFoundException(kbError(KBErrorCodes.PAYEE_NOT_FOUND))
      }
      if (payee.realNameStatus !== RealNameStatus.VERIFIED) {
        throw new BadRequestException(kbError(KBErrorCodes.PAYEE_NOT_VERIFIED))
      }
      if (dto.designatedReceiverId === senderId) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIM_SELF))
      }
    }

    // 风控检查：发红包前检查发送方
    const riskResult = await this.riskEngine.check({
      userId: senderId,
      type: 'RED_PACKET',
      amount: amountFen,
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
      // 幂等键预检查
      if (dto.idempotencyKey) {
        const existing = await tx.redPacket.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        })
        if (existing) {
          if (existing.senderId !== senderId) {
            throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
          }
          return existing
        }
      }

      // 单日发红包限额
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
        amountFen,
        redPacketLimit,
      )

      const account = await tx.account.findUnique({ where: { userId: senderId } })
      if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
      if (account.availableBalance < amountFen) {
        throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
      }

      const packetNo = generateOrderNo('RP')
      const expiresAt = new Date(Date.now() + RED_PACKET_EXPIRY_MS)

      const packet = await tx.redPacket.create({
        data: {
          packetNo,
          senderId,
          amount: amountFen,
          status: RedPacketStatus.PENDING,
          remark: dto.remark,
          expiresAt,
          idempotencyKey: dto.idempotencyKey,
          type,
          totalCount,
          remainingCount: totalCount,
          perAmount: perAmountFen,
          password: dto.password,
          designatedReceiverId: dto.designatedReceiverId,
          receivedAmount: 0,
        },
      })

      const deductResult = await tx.account.updateMany({
        where: {
          id: account.id,
          availableBalance: { gte: amountFen },
        },
        data: {
          availableBalance: { decrement: amountFen },
          frozenBalance: { increment: amountFen },
        },
      })
      if (deductResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
      }

      const updatedAccount = await tx.account.findUnique({
        where: { id: account.id },
      })

      const rpBalanceAfter = updatedAccount!.availableBalance
      const rpBalanceBefore = rpBalanceAfter + amountFen

      await tx.accountLedger.create({
        data: {
          accountId: account.id,
          transactionId: packet.id,
          type: LedgerType.RED_PACKET,
          amount: amountFen,
          balanceBefore: rpBalanceBefore,
          balanceAfter: rpBalanceAfter,
          direction: Direction.CREDIT,
          remark: `发出${this.typeLabel(type)}红包`,
        },
      })

      return packet
      }),
    ).then((packet) => {
      this.riskEngine.recordTransaction({
        userId: senderId,
        type: 'RED_PACKET',
        amount: amountFen,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(RED_PACKET create) 失败: ${err?.message || err}`)
      })
      return packet
    })
  }

  async receive(
    receiverId: string,
    packetNo: string,
    options: { idempotencyKey?: string; password?: string } = {},
  ) {
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
        include: { sender: { select: { nickname: true } } },
      })
      if (!packet) throw new NotFoundException(kbError(KBErrorCodes.RED_PACKET_NOT_FOUND))

      // 幂等返回：当前用户已领取过该红包
      const existingRecord = await tx.redPacketRecord.findFirst({
        where: {
          redPacketId: packet.id,
          receiverId,
          type: RedPacketRecordType.RECEIVE,
        },
      })
      if (existingRecord) return existingRecord

      // 校验红包状态
      if (
        packet.status !== RedPacketStatus.PENDING &&
        packet.status !== RedPacketStatus.PARTIALLY_RECEIVED
      ) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIMED_OR_EXPIRED))
      }
      if (packet.senderId === receiverId) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIM_SELF))
      }
      if (packet.expiresAt < new Date()) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_EXPIRED))
      }
      if (packet.remainingCount <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_CLAIMED_OR_EXPIRED))
      }

      const type = packet.type as RedPacketType

      // EXCLUSIVE：仅指定收款人可领
      if (type === RedPacketType.EXCLUSIVE) {
        if (packet.designatedReceiverId !== receiverId) {
          throw new ForbiddenException(kbError(KBErrorCodes.RED_PACKET_DESIGNATED_MISMATCH))
        }
      }

      // PASSWORD：校验口令
      if (type === RedPacketType.PASSWORD) {
        if (!options.password) {
          throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_PASSWORD_REQUIRED))
        }
        if (packet.password !== options.password) {
          throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_PASSWORD_INCORRECT))
        }
      }

      // 计算本次领取金额
      const claimAmount = this.calculateClaimAmount(packet)

      // 风控检查
      const riskResult = await this.riskEngine.check({
        userId: receiverId,
        type: 'RED_PACKET',
        amount: claimAmount,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `领取红包被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
          ),
        )
      }

      // 乐观锁：使用条件更新扣减 remainingCount
      // 仅当 remainingCount 仍 >0 时才能扣减
      const claimResult = await tx.redPacket.updateMany({
        where: {
          id: packet.id,
          remainingCount: { gt: 0 },
          status: { in: [RedPacketStatus.PENDING, RedPacketStatus.PARTIALLY_RECEIVED] },
        },
        data: {
          remainingCount: { decrement: 1 },
          receivedAmount: { increment: claimAmount },
          // 如果是最后一个，更新为 RECEIVED；否则标记为 PARTIALLY_RECEIVED
          status: packet.remainingCount === 1 ? RedPacketStatus.RECEIVED : RedPacketStatus.PARTIALLY_RECEIVED,
          receivedAt: packet.remainingCount === 1 ? new Date() : packet.receivedAt,
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
          availableBalance: { increment: claimAmount },
          totalBalance: { increment: claimAmount },
        },
      })

      const senderAccount = await tx.account.findUnique({
        where: { userId: packet.senderId },
      })
      if (!senderAccount) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND, '发红包账户不存在'))

      const releaseResult = await tx.account.updateMany({
        where: {
          id: senderAccount.id,
          frozenBalance: { gte: claimAmount },
        },
        data: {
          frozenBalance: { decrement: claimAmount },
          totalBalance: { decrement: claimAmount },
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
          amount: claimAmount,
          type: RedPacketRecordType.RECEIVE,
        },
      })

      await tx.accountLedger.create({
        data: {
          accountId: senderAccount.id,
          transactionId: packet.id,
          type: LedgerType.RED_PACKET,
          amount: claimAmount,
          balanceBefore: updatedSender!.frozenBalance + claimAmount,
          balanceAfter: updatedSender!.frozenBalance,
          direction: Direction.CREDIT,
          remark: `${this.typeLabel(type)}红包被 ${receiver.nickname} 领取`,
        },
      })

      await tx.accountLedger.create({
        data: {
          accountId: receiverAccount.id,
          transactionId: packet.id,
          type: LedgerType.RED_PACKET,
          amount: claimAmount,
          balanceBefore: updatedReceiver.availableBalance - claimAmount,
          balanceAfter: updatedReceiver.availableBalance,
          direction: Direction.DEBIT,
          remark: `领取 ${packet.sender.nickname} 的${this.typeLabel(type)}红包`,
        },
      })

      await tx.bill.create({
        data: {
          userId: packet.senderId,
          transactionId: packet.id,
          type: BillType.RED_PACKET,
          direction: BillDirection.EXPENSE,
          amount: claimAmount,
          counterparty: receiver.nickname,
          remark: packet.remark || `${this.typeLabel(type)}红包`,
        },
      })
      await tx.bill.create({
        data: {
          userId: receiverId,
          transactionId: packet.id,
          type: BillType.RED_PACKET,
          direction: BillDirection.INCOME,
          amount: claimAmount,
          counterparty: packet.sender.nickname,
          remark: packet.remark || `${this.typeLabel(type)}红包`,
        },
      })

      return {
        packetNo: packet.packetNo,
        amount: claimAmount,
        type,
        remainingCount: packet.remainingCount - 1,
        receivedAmount: packet.receivedAmount + claimAmount,
        status: packet.remainingCount === 1 ? RedPacketStatus.RECEIVED : RedPacketStatus.PARTIALLY_RECEIVED,
      }
      }),
    ).then((result) => {
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
      // PENDING 或 PARTIALLY_RECEIVED 都可以过期退回
      if (
        packet.status !== RedPacketStatus.PENDING &&
        packet.status !== RedPacketStatus.PARTIALLY_RECEIVED
      ) {
        return packet
      }
      return this.returnPacket(tx, packet.id)
    })
  }

  private async returnPacket(tx: Prisma.TransactionClient, packetId: string) {
    // 乐观锁：仅当仍为 PENDING/PARTIALLY_RECEIVED 时才标记为过期
    const lockResult = await tx.redPacket.updateMany({
      where: {
        id: packetId,
        status: { in: [RedPacketStatus.PENDING, RedPacketStatus.PARTIALLY_RECEIVED] },
      },
      data: {
        status: RedPacketStatus.EXPIRED,
        returnedAt: new Date(),
      },
    })
    if (lockResult.count === 0) {
      return
    }
    const packet = await tx.redPacket.findUnique({ where: { id: packetId } })
    if (!packet) return

    // 退回剩余冻结金额（amount - receivedAmount），不是退全部
    const refundAmount = packet.amount - packet.receivedAmount
    if (refundAmount <= 0) {
      // 没有可退金额，仅记录 RETURN 记录（全员已领完的情况理论上不会进入这里）
      return packet
    }

    const account = await tx.account.findUnique({
      where: { userId: packet.senderId },
    })
    if (!account) throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))

    const returnResult = await tx.account.updateMany({
      where: {
        id: account.id,
        frozenBalance: { gte: refundAmount },
      },
      data: {
        availableBalance: { increment: refundAmount },
        frozenBalance: { decrement: refundAmount },
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
        amount: refundAmount,
        type: RedPacketRecordType.RETURN,
      },
    })

    await tx.accountLedger.create({
      data: {
        accountId: account.id,
        transactionId: packet.id,
        type: LedgerType.RED_PACKET,
        amount: refundAmount,
        balanceBefore: updatedAccount!.availableBalance - refundAmount,
        balanceAfter: updatedAccount!.availableBalance,
        direction: Direction.DEBIT,
        remark: `${this.typeLabel(packet.type as RedPacketType)}红包过期退回`,
      },
    })

    await tx.bill.create({
      data: {
        userId: packet.senderId,
        transactionId: packet.id,
        type: BillType.RED_PACKET,
        direction: BillDirection.INCOME,
        amount: refundAmount,
        remark: `${this.typeLabel(packet.type as RedPacketType)}红包过期退回`,
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
      include: { redPacket: { include: { sender: { select: { nickname: true } } } } },
    })
  }

  // ============== 私有方法 ==============

  /**
   * 校验创建红包时的协议约束
   */
  private validateCreatePayload(
    type: RedPacketType,
    totalCount: number,
    amountFen: number,
    perAmountFen: number | null,
    dto: CreateRedPacketDto,
  ) {
    if (!Object.values(RedPacketType).includes(type)) {
      throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_TYPE_INVALID))
    }
    if (totalCount < 1 || totalCount > RedPacketsService.MAX_TOTAL_COUNT) {
      throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_COUNT_INVALID))
    }

    switch (type) {
      case RedPacketType.LUCKY: {
        // 拼手气：每人至少 1 分，总金额 >= 总人数
        if (amountFen < totalCount) {
          throw new BadRequestException(
            kbError(KBErrorCodes.RED_PACKET_AMOUNT_INVALID, '拼手气红包金额需大于等于总数量（分）'),
          )
        }
        break
      }
      case RedPacketType.ORDINARY: {
        // 普通红包：perAmount 必填，且 perAmount × totalCount = amount
        if (!perAmountFen || perAmountFen <= 0) {
          throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_PER_AMOUNT_INVALID))
        }
        if (perAmountFen > RedPacketsService.MAX_PER_CLAIM_CENTS) {
          throw new BadRequestException(
            kbError(KBErrorCodes.RED_PACKET_PER_AMOUNT_INVALID, '普通红包单人金额上限 200 元'),
          )
        }
        if (perAmountFen * totalCount !== amountFen) {
          throw new BadRequestException(
            kbError(KBErrorCodes.RED_PACKET_PER_AMOUNT_INVALID, 'perAmount × totalCount 必须等于 amount'),
          )
        }
        break
      }
      case RedPacketType.EXCLUSIVE: {
        // 专属红包：totalCount 必须=1，designatedReceiverId 必填
        if (totalCount !== 1) {
          throw new BadRequestException(
            kbError(KBErrorCodes.RED_PACKET_COUNT_INVALID, '专属红包 totalCount 必须为 1'),
          )
        }
        if (!dto.designatedReceiverId) {
          throw new BadRequestException(
            kbError(KBErrorCodes.RED_PACKET_DESIGNATED_MISMATCH, '专属红包必须指定 designatedReceiverId'),
          )
        }
        break
      }
      case RedPacketType.PASSWORD: {
        // 口令红包：totalCount 必须=1，password 必填
        if (totalCount !== 1) {
          throw new BadRequestException(
            kbError(KBErrorCodes.RED_PACKET_COUNT_INVALID, '口令红包 totalCount 必须为 1'),
          )
        }
        if (!dto.password || dto.password.length < 4) {
          throw new BadRequestException(kbError(KBErrorCodes.RED_PACKET_PASSWORD_REQUIRED))
        }
        break
      }
    }
  }

  /**
   * 计算本次领取金额
   * - LUCKY：随机分配，剩余金额不能小于剩余次数 × 1分
   * - ORDINARY：固定 perAmount
   * - EXCLUSIVE/PASSWORD：金额为 amount
   */
  private calculateClaimAmount(packet: any): number {
    const type = packet.type as RedPacketType

    switch (type) {
      case RedPacketType.ORDINARY: {
        return packet.perAmount
      }
      case RedPacketType.EXCLUSIVE:
      case RedPacketType.PASSWORD: {
        return packet.amount
      }
      case RedPacketType.LUCKY:
      default: {
        const remainingAmount = packet.amount - packet.receivedAmount
        const remainingCount = packet.remainingCount

        if (remainingCount === 1) {
          // 最后一人领取全部剩余
          return remainingAmount
        }

        // 微信红包算法（二倍均值法）：
        // 每次最大金额 = 剩余金额 / 剩余人数 × 2 - 1
        // 保证至少 1 分，且剩余金额足够后面每人 1 分
        const maxAmount = Math.floor((remainingAmount / remainingCount) * 2) - 1
        const minAmount = 1

        if (maxAmount < minAmount) {
          // 边界：剩余金额刚好等于剩余人数（每人 1 分）
          return minAmount
        }

        // 随机生成 [minAmount, maxAmount]
        const randomAmount = minAmount + Math.floor(Math.random() * (maxAmount - minAmount + 1))
        return randomAmount
      }
    }
  }

  private typeLabel(type: RedPacketType): string {
    switch (type) {
      case RedPacketType.LUCKY: return '拼手气'
      case RedPacketType.ORDINARY: return '普通'
      case RedPacketType.EXCLUSIVE: return '专属'
      case RedPacketType.PASSWORD: return '口令'
      default: return ''
    }
  }
}
