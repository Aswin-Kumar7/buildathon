import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
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
  // The audit controller is session-guarded, and SessionGuard needs AuthService. The service this
  // module exports is global; the guard on its own controller is not, so the dependency has to be
  // imported here like any other module's would.
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
