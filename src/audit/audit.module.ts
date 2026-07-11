import { Global, Module } from '@nestjs/common'
import { AuditLogService } from './audit-log.service'
import { AuditSchedule } from './audit.schedule'

@Global()
@Module({
  providers: [AuditLogService, AuditSchedule],
  exports: [AuditLogService],
})
export class AuditModule {}
