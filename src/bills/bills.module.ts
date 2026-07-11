import { Module } from '@nestjs/common'
import { BillsService } from './bills.service'
import { BillsController } from './bills.controller'

@Module({
  providers: [BillsService],
  controllers: [BillsController],
  exports: [BillsService],
})
export class BillsModule {}
