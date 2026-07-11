import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    return this.prisma.account.findUnique({
      where: { userId },
      include: { ledgers: { orderBy: { createdAt: 'desc' }, take: 20 } },
    })
  }
}
