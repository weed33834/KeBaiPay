import { Module } from '@nestjs/common'
import { BankCardsController } from './bank-cards.controller'
import { BankCardsService } from './bank-cards.service'
import { PrismaModule } from '../prisma/prisma.module'
import { CryptoModule } from '../crypto/crypto.module'

@Module({
  imports: [PrismaModule, CryptoModule],
  providers: [BankCardsService],
  controllers: [BankCardsController],
  exports: [BankCardsService],
})
export class BankCardsModule {}
