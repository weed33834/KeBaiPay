import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  MessageCategory,
  MessagePriority,
  MessageStatus,
  NotifyChannel,
} from '../common/enums'
import { NotificationsService } from '../notifications/notifications.service'
import { generateOrderNo } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { SendMessageDto, ListMessageDto, BroadcastMessageDto } from './dto/message.dto'

/**
 * 消息中心 + 多通道推送服务
 *
 * 1. 站内信：所有消息默认写 messages 表
 * 2. 多通道推送：根据 channels 字段决定额外推送 SMS / EMAIL
 * 3. 广播消息：userId=null，所有用户可见；用户 read 后写 MessageRead
 * 4. 定向消息：userId=具体用户，仅该用户可见
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** 发送消息（定向或广播） */
  async sendMessage(dto: SendMessageDto) {
    const channels = dto.channels || NotifyChannel.IN_APP
    const priority = dto.priority || MessagePriority.NORMAL
    const isBroadcast = !dto.userId

    const message = await this.prisma.message.create({
      data: {
        messageNo: generateOrderNo('MSG'),
        userId: dto.userId || null,
        category: dto.category,
        title: dto.title,
        content: dto.content,
        link: dto.link,
        channels,
        priority,
        status: MessageStatus.SENT,
      },
    })

    // 异步推送其他通道（不阻塞主流程）
    this.pushOtherChannels(message, channels).catch((err) => {
      this.logger.error(`消息多通道推送失败: ${message.messageNo}`, (err as Error).stack)
    })

    return message
  }

  /** 广播消息 */
  async broadcast(dto: BroadcastMessageDto) {
    return this.sendMessage({
      ...dto,
      userId: undefined, // 广播
    })
  }

  /** 查询我的消息列表（含广播 + 定向） */
  async listMyMessages(userId: string, query: ListMessageDto) {
    const where: Prisma.MessageWhereInput = {
      OR: [{ userId }, { userId: null }],
    }
    if (query.category) where.category = query.category
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))

    const [items, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          reads: {
            where: { userId },
            select: { id: true, readAt: true },
          },
        },
      }),
      this.prisma.message.count({ where }),
    ])

    // 转换：isRead 字段
    const itemsWithReadFlag = items.map((m) => ({
      ...m,
      isRead: m.reads.length > 0,
    }))

    return { items: itemsWithReadFlag, total, page, limit }
  }

  /** 未读数量 */
  async getUnreadCount(userId: string) {
    // 未读 = (定向 + 广播) - 已读
    const [total, readCount] = await Promise.all([
      this.prisma.message.count({
        where: { OR: [{ userId }, { userId: null }] },
      }),
      this.prisma.messageRead.count({
        where: { userId },
      }),
    ])
    return { unread: Math.max(0, total - readCount), total, read: readCount }
  }

  /** 标记消息已读 */
  async markAsRead(userId: string, messageNo: string) {
    const message = await this.prisma.message.findUnique({
      where: { messageNo },
    })
    if (!message) {
      throw new NotFoundException(kbError(KBErrorCodes.MESSAGE_NOT_FOUND))
    }
    // 权限校验：定向消息只有本人可读；广播消息所有人可读
    if (message.userId && message.userId !== userId) {
      throw new NotFoundException(kbError(KBErrorCodes.MESSAGE_NOT_FOUND))
    }

    // 已读记录（唯一约束防重）
    try {
      await this.prisma.messageRead.create({
        data: {
          messageId: message.id,
          userId,
        },
      })
    } catch (err) {
      // 唯一约束冲突 = 已读，幂等返回
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { messageNo, alreadyRead: true }
      }
      throw err
    }
    return { messageNo, alreadyRead: false }
  }

  /** 批量标记已读 */
  async markAllAsRead(userId: string) {
    // 找出所有未读消息
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        OR: [{ userId }, { userId: null }],
        reads: { none: { userId } },
      },
      select: { id: true },
    })
    if (unreadMessages.length === 0) {
      return { marked: 0 }
    }
    // 批量创建已读记录
    await this.prisma.messageRead.createMany({
      data: unreadMessages.map((m) => ({
        messageId: m.id,
        userId,
      })),
      skipDuplicates: true,
    })
    return { marked: unreadMessages.length }
  }

  /** 删除消息（仅定向消息，广播消息不可删） */
  async deleteMessage(userId: string, messageNo: string) {
    const message = await this.prisma.message.findUnique({
      where: { messageNo },
    })
    if (!message) {
      throw new NotFoundException(kbError(KBErrorCodes.MESSAGE_NOT_FOUND))
    }
    if (!message.userId || message.userId !== userId) {
      throw new BadRequestException(kbError(KBErrorCodes.MESSAGE_CANNOT_DELETE))
    }
    await this.prisma.message.delete({ where: { id: message.id } })
    return { messageNo, deleted: true }
  }

  /** 消息详情 */
  async findByMessageNo(messageNo: string, userId?: string) {
    const message = await this.prisma.message.findUnique({
      where: { messageNo },
    })
    if (!message) {
      throw new NotFoundException(kbError(KBErrorCodes.MESSAGE_NOT_FOUND))
    }
    // 权限校验
    if (userId && message.userId && message.userId !== userId) {
      throw new NotFoundException(kbError(KBErrorCodes.MESSAGE_NOT_FOUND))
    }
    return message
  }

  // ============== 私有方法 ==============

  /** 推送除站内信外的其他通道（SMS/EMAIL） */
  private async pushOtherChannels(message: any, channels: string) {
    const channelList = channels.split(',').map((c: string) => c.trim())
    const needSms = channelList.includes(NotifyChannel.SMS)
    const needEmail = channelList.includes(NotifyChannel.EMAIL)

    if (!needSms && !needEmail) return

    // 广播消息不发短信/邮件（避免大量发送）
    if (!message.userId) {
      this.logger.log(`广播消息 ${message.messageNo} 跳过 SMS/EMAIL 推送`)
      return
    }

    // 查询用户联系方式
    const user = await this.prisma.user.findUnique({
      where: { id: message.userId },
      select: { phone: true, email: true },
    })
    if (!user) return

    if (needSms && user.phone) {
      // SmsService 仅支持验证码场景，通用消息通过日志模拟
      this.logger.log(`[SMS 模拟] ${message.messageNo} -> ${user.phone}: ${message.title}`)
    }

    if (needEmail && user.email) {
      try {
        await this.notificationsService.sendEmail({
          to: user.email,
          subject: message.title,
          html: `<div><h2>${message.title}</h2><p>${message.content}</p></div>`,
        })
        this.logger.log(`EMAIL 推送成功: ${message.messageNo} -> ${user.email}`)
      } catch (err) {
        this.logger.error(`EMAIL 推送失败: ${message.messageNo}`, (err as Error).stack)
      }
    }
  }
}
