import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import { BillDirection } from '../common/enums'
import { BILL_LIST_LIMIT } from '../common/constants'

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: string, direction?: BillDirection) {
    const where: Prisma.BillWhereInput = { userId }
    if (direction) {
      where.direction = direction
    }
    return this.prisma.bill.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: BILL_LIST_LIMIT,
    })
  }
}
