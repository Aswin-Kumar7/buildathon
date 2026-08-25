import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * Global, because the audit chain has to record what happens across the whole system, and a
 * service several other modules append to is one they should not each have to wire up. Exporting
 * it once and importing it everywhere by hand is how two callers end up appending to two
 * different things.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
