import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { MessagesService } from './messages.service'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

describe('MessagesService', () => {
  let service: MessagesService
  let prisma: any
  let notificationsService: any

  beforeEach(async () => {
    prisma = {
      message: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn(),
      },
      messageRead: {
        create: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    }

    notificationsService = {
      sendEmail: jest.fn().mockResolvedValue(true),
    }

    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile()

    service = module.get(MessagesService)
  })

  // ============== sendMessage ==============
  describe('sendMessage', () => {
    it('应创建定向消息', async () => {
      prisma.message.create.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u1',
        title: '测试',
      })
      const result = await service.sendMessage({
        userId: 'u1',
        category: 'SYSTEM',
        title: '测试',
        content: '内容',
      })
      expect(result?.messageNo).toBe('MSG1')
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            category: 'SYSTEM',
          }),
        }),
      )
    })

    it('应创建广播消息（userId 为空）', async () => {
      prisma.message.create.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: null,
      })
      const result = await service.sendMessage({
        category: 'SYSTEM',
        title: '广播',
        content: '内容',
      })
      expect(result?.userId).toBeNull()
    })

    it('默认 channels 为 IN_APP', async () => {
      prisma.message.create.mockResolvedValue({ id: 'm1', messageNo: 'MSG1' })
      await service.sendMessage({
        category: 'SYSTEM',
        title: '测试',
        content: '内容',
      })
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channels: 'IN_APP',
          }),
        }),
      )
    })
  })

  // ============== broadcast ==============
  describe('broadcast', () => {
    it('应创建广播消息', async () => {
      prisma.message.create.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: null,
      })
      const result = await service.broadcast({
        category: 'SYSTEM',
        title: '广播',
        content: '内容',
      })
      expect(result?.userId).toBeNull()
    })
  })

  // ============== listMyMessages ==============
  describe('listMyMessages', () => {
    it('应返回定向+广播消息列表', async () => {
      prisma.message.findMany.mockResolvedValue([
        {
          id: 'm1',
          messageNo: 'MSG1',
          userId: 'u1',
          reads: [],
        },
        {
          id: 'm2',
          messageNo: 'MSG2',
          userId: null,
          reads: [{ id: 'r1', readAt: new Date() }],
        },
      ])
      prisma.message.count.mockResolvedValue(2)
      const result = await service.listMyMessages('u1', {})
      expect(result.total).toBe(2)
      expect(result.items).toHaveLength(2)
      expect(result.items[0].isRead).toBe(false)
      expect(result.items[1].isRead).toBe(true)
    })

    it('category 过滤生效', async () => {
      prisma.message.findMany.mockResolvedValue([])
      await service.listMyMessages('u1', { category: 'SYSTEM' })
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: 'SYSTEM',
          }),
        }),
      )
    })
  })

  // ============== getUnreadCount ==============
  describe('getUnreadCount', () => {
    it('应返回正确未读数', async () => {
      prisma.message.count.mockResolvedValue(10)
      prisma.messageRead.count.mockResolvedValue(3)
      const result = await service.getUnreadCount('u1')
      expect(result.unread).toBe(7)
      expect(result.total).toBe(10)
      expect(result.read).toBe(3)
    })

    it('无未读时返回 0', async () => {
      prisma.message.count.mockResolvedValue(5)
      prisma.messageRead.count.mockResolvedValue(5)
      const result = await service.getUnreadCount('u1')
      expect(result.unread).toBe(0)
    })
  })

  // ============== markAsRead ==============
  describe('markAsRead', () => {
    it('消息不存在应抛 404', async () => {
      prisma.message.findUnique.mockResolvedValue(null)
      await expect(service.markAsRead('u1', 'NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('无权读取他人定向消息应抛 404', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u-other',
      })
      await expect(service.markAsRead('u1', 'MSG1')).rejects.toThrow(NotFoundException)
    })

    it('成功标记已读', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u1',
      })
      prisma.messageRead.create.mockResolvedValue({ id: 'r1' })
      const result = await service.markAsRead('u1', 'MSG1')
      expect(result.alreadyRead).toBe(false)
    })

    it('重复标记已读应幂等返回', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u1',
      })
      const { Prisma } = require('@prisma/client')
      prisma.messageRead.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '7.0',
        }),
      )
      const result = await service.markAsRead('u1', 'MSG1')
      expect(result.alreadyRead).toBe(true)
    })

    it('广播消息任何用户可读', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: null,
      })
      prisma.messageRead.create.mockResolvedValue({ id: 'r1' })
      const result = await service.markAsRead('u1', 'MSG1')
      expect(result.alreadyRead).toBe(false)
    })
  })

  // ============== markAllAsRead ==============
  describe('markAllAsRead', () => {
    it('无未读时返回 marked=0', async () => {
      prisma.message.findMany.mockResolvedValue([])
      const result = await service.markAllAsRead('u1')
      expect(result.marked).toBe(0)
    })

    it('应批量标记已读', async () => {
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1' },
        { id: 'm2' },
      ])
      prisma.messageRead.createMany.mockResolvedValue({ count: 2 })
      const result = await service.markAllAsRead('u1')
      expect(result.marked).toBe(2)
      expect(prisma.messageRead.createMany).toHaveBeenCalled()
    })
  })

  // ============== deleteMessage ==============
  describe('deleteMessage', () => {
    it('消息不存在应抛 404', async () => {
      prisma.message.findUnique.mockResolvedValue(null)
      await expect(service.deleteMessage('u1', 'NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('广播消息不可删应抛错', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: null,
      })
      await expect(service.deleteMessage('u1', 'MSG1')).rejects.toThrow(BadRequestException)
    })

    it('他人定向消息不可删应抛错', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u-other',
      })
      await expect(service.deleteMessage('u1', 'MSG1')).rejects.toThrow(BadRequestException)
    })

    it('成功删除自己的定向消息', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u1',
      })
      prisma.message.delete.mockResolvedValue({})
      const result = await service.deleteMessage('u1', 'MSG1')
      expect(result.deleted).toBe(true)
    })
  })

  // ============== findByMessageNo ==============
  describe('findByMessageNo', () => {
    it('不存在应抛 404', async () => {
      prisma.message.findUnique.mockResolvedValue(null)
      await expect(service.findByMessageNo('NOTEXIST', 'u1')).rejects.toThrow(NotFoundException)
    })

    it('无权查看他人定向消息应抛 404', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u-other',
      })
      await expect(service.findByMessageNo('MSG1', 'u1')).rejects.toThrow(NotFoundException)
    })

    it('广播消息任何用户可查看', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: null,
      })
      const result = await service.findByMessageNo('MSG1', 'u1')
      expect(result?.messageNo).toBe('MSG1')
    })

    it('自己的定向消息可查看', async () => {
      prisma.message.findUnique.mockResolvedValue({
        id: 'm1',
        messageNo: 'MSG1',
        userId: 'u1',
      })
      const result = await service.findByMessageNo('MSG1', 'u1')
      expect(result?.messageNo).toBe('MSG1')
    })
  })
})
