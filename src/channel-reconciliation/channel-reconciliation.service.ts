import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import {
  ChannelStatementItemType,
  ChannelStatementStatus,
  MatchStatus,
  ReconciliationDiffStatus,
  ReconciliationDiffType,
  TransactionStatus,
  TransactionType,
  WithdrawalStatus,
} from '../common/enums'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { computePagination, paginateResult } from '../common/pagination'
import { getDateRange } from '../common/date-helpers'
import type {
  FetchStatementDto,
  ListDifferencesQueryDto,
  ListStatementItemsQueryDto,
  ListStatementsQueryDto,
  AssignDifferenceDto,
  ResolveDifferenceDto,
} from './dto/channel-reconciliation.dto'

/**
 * S5 多平台对账聚合服务
 *
 * 设计目标：
 *  - 拉取各支付渠道的对账文件（mock 实现：从平台已有交易/提现订单生成对账条目）
 *  - 与平台订单做交叉匹配，发现 4 类差异
 *  - 差异处理工作流：PENDING → INVESTIGATING → RESOLVED / IGNORED
 *
 * 状态机：
 *   ChannelStatement:    PENDING → FETCHED / FAILED
 *   ChannelStatementItem: UNMATCHED → MATCHED / MISMATCHED
 *   ReconciliationDifferenceItem: PENDING → INVESTIGATING → RESOLVED / IGNORED
 */
@Injectable()
export class ChannelReconciliationService {
  private readonly logger = new Logger(ChannelReconciliationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ============== 渠道对账单 ==============

  /**
   * 拉取渠道对账单
   *
   * Mock 实现：从平台 transactionOrder + withdrawalOrder 中筛选指定渠道 + 日期的订单，
   * 转换为对账条目并写入 ChannelStatementItem。
   *
   * 真实实现应：调用渠道 API（如微信支付 bills/download、支付宝 data_bill），
   * 解析返回的对账文件（CSV/TXT），按渠道流水格式逐行转换。
   *
   * 幂等性：若同渠道同日已 FETCHED，拒绝重复拉取；FAILED 可重试。
   */
  async fetchStatement(dto: FetchStatementDto, fetchedBy: string) {
    return this.redis.withLock(
      `lock:channel-stmt:${dto.channelCode}:${dto.date}`,
      30,
      async () => this.doFetchStatement(dto, fetchedBy),
    )
  }

  private async doFetchStatement(dto: FetchStatementDto, fetchedBy: string) {
    const existing = await this.prisma.channelStatement.findUnique({
      where: {
        channelCode_date: { channelCode: dto.channelCode, date: dto.date },
      },
    })
    if (existing && existing.status === ChannelStatementStatus.FETCHED) {
      throw new BadRequestException(
        kbError(KBErrorCodes.CHANNEL_STATEMENT_ALREADY_FETCHED),
      )
    }

    const { start, end } = getDateRange(dto.date, dto.date)
    // 平台订单：与该渠道相关的、当日完成的 transactionOrder
    const txOrders = await this.prisma.transactionOrder.findMany({
      where: {
        channel: dto.channelCode,
        completedAt: { gte: start, lte: end },
        status: TransactionStatus.SUCCESS,
        channelOrderNo: { not: null },
      },
      select: {
        orderNo: true,
        channelOrderNo: true,
        type: true,
        amount: true,
        fee: true,
        status: true,
      },
    })
    // 平台订单：与该渠道相关的、当日成功的 withdrawalOrder（代付场景）
    const withdrawals = await this.prisma.withdrawalOrder.findMany({
      where: {
        channel: dto.channelCode,
        reviewedAt: { gte: start, lte: end },
        status: WithdrawalStatus.SUCCESS,
        channelOrderNo: { not: null },
      },
      select: {
        orderNo: true,
        channelOrderNo: true,
        amount: true,
        fee: true,
        actualAmount: true,
        status: true,
      },
    })

    const itemsData: Array<{
      channelOrderNo: string
      type: string
      amount: number
      fee: number
      status: string
      rawPayload: string
    }> = []
    for (const o of txOrders) {
      const type = this.txTypeToStatementType(o.type as TransactionType)
      itemsData.push({
        channelOrderNo: o.channelOrderNo!,
        type,
        amount: o.amount,
        fee: o.fee,
        status: 'SUCCESS',
        rawPayload: JSON.stringify({
          source: 'transaction',
          orderNo: o.orderNo,
          type: o.type,
        }),
      })
    }
    for (const w of withdrawals) {
      itemsData.push({
        channelOrderNo: w.channelOrderNo!,
        type: ChannelStatementItemType.PAYOUT,
        amount: w.actualAmount,
        fee: w.fee,
        status: 'SUCCESS',
        rawPayload: JSON.stringify({
          source: 'withdrawal',
          orderNo: w.orderNo,
        }),
      })
    }

    const totalCount = itemsData.length
    const totalAmount = itemsData.reduce((s, x) => s + x.amount, 0)

    try {
      const result = await this.prisma.channelStatement.upsert({
        where: {
          channelCode_date: { channelCode: dto.channelCode, date: dto.date },
        },
        // 已存在（FAILED 重拉）：先清旧 items，再写新 items
        update: {
          status: ChannelStatementStatus.FETCHED,
          totalCount,
          totalAmount,
          fetchedAt: new Date(),
          fetchedBy,
          errorMessage: null,
        },
        create: {
          channelCode: dto.channelCode,
          date: dto.date,
          status: ChannelStatementStatus.FETCHED,
          totalCount,
          totalAmount,
          fetchedAt: new Date(),
          fetchedBy,
        },
        include: { items: true },
      })

      // 重拉场景：清掉旧 items
      if (existing) {
        await this.prisma.channelStatementItem.deleteMany({
          where: { statementId: result.id },
        })
        // 同步清掉旧的关联差异项（基于旧 items 的 channelOrderNo）
        await this.prisma.reconciliationDifferenceItem.deleteMany({
          where: {
            reportDate: dto.date,
            channelCode: dto.channelCode,
          },
        })
      }

      if (itemsData.length > 0) {
        await this.prisma.channelStatementItem.createMany({
          data: itemsData.map((it) => ({
            statementId: result.id,
            channelOrderNo: it.channelOrderNo,
            channelCode: dto.channelCode,
            date: dto.date,
            type: it.type,
            amount: it.amount,
            fee: it.fee,
            status: it.status,
            matchStatus: MatchStatus.UNMATCHED,
            rawPayload: it.rawPayload,
          })),
        })
      }

      this.logger.log(
        `渠道对账单拉取成功 channel=${dto.channelCode} date=${dto.date} count=${totalCount}`,
      )
      return this.getStatement(result.id)
    } catch (err) {
      // 失败：更新状态为 FAILED
      if (existing) {
        await this.prisma.channelStatement.update({
          where: { id: existing.id },
          data: {
            status: ChannelStatementStatus.FAILED,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        })
      } else {
        await this.prisma.channelStatement.create({
          data: {
            channelCode: dto.channelCode,
            date: dto.date,
            status: ChannelStatementStatus.FAILED,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        })
      }
      this.logger.error(
        `渠道对账单拉取失败 channel=${dto.channelCode} date=${dto.date}`,
        err,
      )
      throw new BadRequestException(
        kbError(KBErrorCodes.CHANNEL_STATEMENT_FETCH_FAILED),
      )
    }
  }

  /** 对账单列表（分页） */
  async listStatements(query: ListStatementsQueryDto) {
    const where: Prisma.ChannelStatementWhereInput = {}
    if (query.channelCode) where.channelCode = query.channelCode
    if (query.date) where.date = query.date
    if (query.status) where.status = query.status

    const { page, limit, skip, take } = computePagination(query)
    const [data, total] = await Promise.all([
      this.prisma.channelStatement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.channelStatement.count({ where }),
    ])
    return paginateResult(data, total, page, limit)
  }

  /** 对账单详情（含 items 摘要前 50 条） */
  async getStatement(id: string) {
    const stmt = await this.prisma.channelStatement.findUnique({
      where: { id },
      include: { items: { take: 50, orderBy: { createdAt: 'asc' } } },
    })
    if (!stmt) {
      throw new NotFoundException(kbError(KBErrorCodes.CHANNEL_STATEMENT_NOT_FOUND))
    }
    return stmt
  }

  /** 对账单条目分页查询 */
  async listStatementItems(statementId: string, query: ListStatementItemsQueryDto) {
    const stmt = await this.prisma.channelStatement.findUnique({
      where: { id: statementId },
      select: { id: true },
    })
    if (!stmt) {
      throw new NotFoundException(kbError(KBErrorCodes.CHANNEL_STATEMENT_NOT_FOUND))
    }
    const where: Prisma.ChannelStatementItemWhereInput = { statementId }
    if (query.type) where.type = query.type
    if (query.matchStatus) where.matchStatus = query.matchStatus
    if (query.channelOrderNo) where.channelOrderNo = query.channelOrderNo

    const { page, limit, skip, take } = computePagination(query)
    const [data, total] = await Promise.all([
      this.prisma.channelStatementItem.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      this.prisma.channelStatementItem.count({ where }),
    ])
    return paginateResult(data, total, page, limit)
  }

  // ============== 匹配 ==============

  /**
   * 执行对账匹配：将渠道流水与平台订单逐条比对
   *
   * 匹配规则：
   *  - 按 channelOrderNo 精确匹配平台 transactionOrder.channelOrderNo 或 withdrawalOrder.channelOrderNo
   *  - 命中且金额一致 → MATCHED
   *  - 命中但金额不一致 → MISMATCHED，生成 AMOUNT_MISMATCH 差异
   *  - 未命中 → UNMATCHED，生成 MISSING_IN_PLATFORM 差异
   *  - 反向：平台订单未出现在渠道流水中 → MISSING_IN_CHANNEL 差异
   *
   * 幂等：可重复执行，每次先清旧差异再生成新差异
   */
  async matchStatement(statementId: string) {
    return this.redis.withLock(
      `lock:channel-match:${statementId}`,
      60,
      async () => this.doMatchStatement(statementId),
    )
  }

  private async doMatchStatement(statementId: string) {
    const stmt = await this.prisma.channelStatement.findUnique({
      where: { id: statementId },
      include: { items: true },
    })
    if (!stmt) {
      throw new NotFoundException(kbError(KBErrorCodes.CHANNEL_STATEMENT_NOT_FOUND))
    }
    if (stmt.status !== ChannelStatementStatus.FETCHED) {
      throw new BadRequestException(
        kbError(KBErrorCodes.CHANNEL_STATEMENT_NOT_FETCHED),
      )
    }

    // 清旧差异（仅本对账单范围内）
    await this.prisma.reconciliationDifferenceItem.deleteMany({
      where: {
        reportDate: stmt.date,
        channelCode: stmt.channelCode,
      },
    })

    let matchedCount = 0
    let mismatchedCount = 0
    let unmatchedCount = 0
    const matchedPlatformOrderNos = new Set<string>()

    for (const item of stmt.items) {
      // 1. 平台 transactionOrder 按 channelOrderNo 匹配
      const txOrder = await this.prisma.transactionOrder.findFirst({
        where: { channelOrderNo: item.channelOrderNo },
        select: {
          orderNo: true,
          amount: true,
          fee: true,
          status: true,
          type: true,
        },
      })
      // 2. 平台 withdrawalOrder 按 channelOrderNo 匹配
      const withdrawal = txOrder
        ? null
        : await this.prisma.withdrawalOrder.findFirst({
            where: { channelOrderNo: item.channelOrderNo },
            select: {
              orderNo: true,
              amount: true,
              fee: true,
              actualAmount: true,
              status: true,
            },
          })

      const matched = txOrder || withdrawal
      if (!matched) {
        // 渠道有，平台无
        unmatchedCount++
        await this.prisma.channelStatementItem.update({
          where: { id: item.id },
          data: {
            matchStatus: MatchStatus.UNMATCHED,
            matchedOrderNo: null,
            matchedType: null,
          },
        })
        await this.prisma.reconciliationDifferenceItem.create({
          data: {
            reportDate: stmt.date,
            channelCode: stmt.channelCode,
            channelOrderNo: item.channelOrderNo,
            platformOrderNo: null,
            diffType: ReconciliationDiffType.MISSING_IN_PLATFORM,
            amount: item.amount,
            description: `渠道流水 ${item.channelOrderNo} 在平台无对应订单`,
            status: ReconciliationDiffStatus.PENDING,
          },
        })
        continue
      }

      matchedPlatformOrderNos.add(matched.orderNo)
      // 校验金额
      const platformAmount =
        matched === txOrder
          ? txOrder!.amount
          : withdrawal!.actualAmount
      const platformFee = matched.fee ?? 0
      const channelAmount = item.amount
      const channelFee = item.fee
      const amountMatches =
        platformAmount === channelAmount && platformFee === channelFee

      if (amountMatches) {
        matchedCount++
        await this.prisma.channelStatementItem.update({
          where: { id: item.id },
          data: {
            matchStatus: MatchStatus.MATCHED,
            matchedOrderNo: matched.orderNo,
            matchedType: txOrder ? 'TRANSACTION' : 'WITHDRAWAL',
          },
        })
      } else {
        // 金额不一致
        mismatchedCount++
        await this.prisma.channelStatementItem.update({
          where: { id: item.id },
          data: {
            matchStatus: MatchStatus.MISMATCHED,
            matchedOrderNo: matched.orderNo,
            matchedType: txOrder ? 'TRANSACTION' : 'WITHDRAWAL',
          },
        })
        await this.prisma.reconciliationDifferenceItem.create({
          data: {
            reportDate: stmt.date,
            channelCode: stmt.channelCode,
            channelOrderNo: item.channelOrderNo,
            platformOrderNo: matched.orderNo,
            diffType: ReconciliationDiffType.AMOUNT_MISMATCH,
            amount: Math.abs(channelAmount - platformAmount),
            description: `订单 ${matched.orderNo} 金额差异：渠道=${channelAmount}分 平台=${platformAmount}分`,
            status: ReconciliationDiffStatus.PENDING,
          },
        })
      }
    }

    // 反向扫描：平台订单未在渠道流水中出现
    const { start, end } = getDateRange(stmt.date, stmt.date)
    const platformTxOrders = await this.prisma.transactionOrder.findMany({
      where: {
        channel: stmt.channelCode,
        completedAt: { gte: start, lte: end },
        status: TransactionStatus.SUCCESS,
        channelOrderNo: { not: null },
      },
      select: { orderNo: true, channelOrderNo: true, amount: true, type: true },
    })
    const platformWithdrawals = await this.prisma.withdrawalOrder.findMany({
      where: {
        channel: stmt.channelCode,
        reviewedAt: { gte: start, lte: end },
        status: WithdrawalStatus.SUCCESS,
        channelOrderNo: { not: null },
      },
      select: { orderNo: true, channelOrderNo: true, actualAmount: true },
    })

    const channelOrderNoSet = new Set(stmt.items.map((i) => i.channelOrderNo))
    let missingInChannelCount = 0
    for (const o of platformTxOrders) {
      if (o.channelOrderNo && !channelOrderNoSet.has(o.channelOrderNo)) {
        missingInChannelCount++
        await this.prisma.reconciliationDifferenceItem.create({
          data: {
            reportDate: stmt.date,
            channelCode: stmt.channelCode,
            channelOrderNo: null,
            platformOrderNo: o.orderNo,
            diffType: ReconciliationDiffType.MISSING_IN_CHANNEL,
            amount: o.amount,
            description: `平台订单 ${o.orderNo} 在渠道对账单中缺失`,
            status: ReconciliationDiffStatus.PENDING,
          },
        })
      }
    }
    for (const w of platformWithdrawals) {
      if (w.channelOrderNo && !channelOrderNoSet.has(w.channelOrderNo)) {
        missingInChannelCount++
        await this.prisma.reconciliationDifferenceItem.create({
          data: {
            reportDate: stmt.date,
            channelCode: stmt.channelCode,
            channelOrderNo: null,
            platformOrderNo: w.orderNo,
            diffType: ReconciliationDiffType.MISSING_IN_CHANNEL,
            amount: w.actualAmount,
            description: `平台提现 ${w.orderNo} 在渠道对账单中缺失`,
            status: ReconciliationDiffStatus.PENDING,
          },
        })
      }
    }

    return {
      statementId,
      matched: matchedCount,
      mismatched: mismatchedCount,
      unmatched: unmatchedCount,
      missingInChannel: missingInChannelCount,
      totalDifferences:
        unmatchedCount + mismatchedCount + missingInChannelCount,
    }
  }

  // ============== 差异处理工作流 ==============

  /** 差异项列表 */
  async listDifferences(query: ListDifferencesQueryDto) {
    const where: Prisma.ReconciliationDifferenceItemWhereInput = {}
    if (query.reportDate) where.reportDate = query.reportDate
    if (query.channelCode) where.channelCode = query.channelCode
    if (query.diffType) where.diffType = query.diffType
    if (query.status) where.status = query.status
    if (query.assignedTo) where.assignedTo = query.assignedTo

    const { page, limit, skip, take } = computePagination(query)
    const [data, total] = await Promise.all([
      this.prisma.reconciliationDifferenceItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.reconciliationDifferenceItem.count({ where }),
    ])
    return paginateResult(data, total, page, limit)
  }

  /** 差异项详情 */
  async getDifference(id: string) {
    const diff = await this.prisma.reconciliationDifferenceItem.findUnique({
      where: { id },
    })
    if (!diff) {
      throw new NotFoundException(
        kbError(KBErrorCodes.RECONCILIATION_DIFF_NOT_FOUND),
      )
    }
    return diff
  }

  /**
   * 指派差异处理人
   * 仅 PENDING 状态可指派；指派后状态变为 INVESTIGATING
   */
  async assignDifference(id: string, dto: AssignDifferenceDto) {
    const diff = await this.prisma.reconciliationDifferenceItem.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!diff) {
      throw new NotFoundException(
        kbError(KBErrorCodes.RECONCILIATION_DIFF_NOT_FOUND),
      )
    }
    if (diff.status !== ReconciliationDiffStatus.PENDING) {
      throw new BadRequestException(
        kbError(KBErrorCodes.RECONCILIATION_DIFF_STATUS_INVALID),
      )
    }
    return this.prisma.reconciliationDifferenceItem.update({
      where: { id },
      data: {
        assignedTo: dto.assignedTo,
        status: ReconciliationDiffStatus.INVESTIGATING,
      },
    })
  }

  /**
   * 标记差异已解决
   * 仅 INVESTIGATING 状态可解决；解决后写入 resolution、resolvedBy、resolvedAt
   * finalStatus 可选 RESOLVED 或 IGNORED（默认 RESOLVED）
   */
  async resolveDifference(
    id: string,
    dto: ResolveDifferenceDto,
    resolvedBy: string,
  ) {
    const diff = await this.prisma.reconciliationDifferenceItem.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!diff) {
      throw new NotFoundException(
        kbError(KBErrorCodes.RECONCILIATION_DIFF_NOT_FOUND),
      )
    }
    if (diff.status !== ReconciliationDiffStatus.INVESTIGATING) {
      throw new BadRequestException(
        kbError(KBErrorCodes.RECONCILIATION_DIFF_STATUS_INVALID),
      )
    }
    const finalStatus =
      dto.finalStatus &&
      (dto.finalStatus === ReconciliationDiffStatus.RESOLVED ||
        dto.finalStatus === ReconciliationDiffStatus.IGNORED)
        ? dto.finalStatus
        : ReconciliationDiffStatus.RESOLVED
    return this.prisma.reconciliationDifferenceItem.update({
      where: { id },
      data: {
        resolution: dto.resolution,
        resolvedBy,
        resolvedAt: new Date(),
        status: finalStatus,
      },
    })
  }

  // ============== 辅助 ==============

  /** 把 transactionOrder.type 映射到对账条目类型 */
  private txTypeToStatementType(txType: TransactionType): string {
    switch (txType) {
      case TransactionType.RECHARGE:
        return ChannelStatementItemType.RECHARGE
      case TransactionType.WITHDRAW:
        return ChannelStatementItemType.PAYOUT
      case TransactionType.REFUND:
        return ChannelStatementItemType.REFUND
      default:
        // 转账/支付/红包等其他类型在渠道侧归类为 RECHARGE（收款侧）
        return ChannelStatementItemType.RECHARGE
    }
  }
}
