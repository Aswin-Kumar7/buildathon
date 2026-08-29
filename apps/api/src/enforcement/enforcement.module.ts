import { Module } from '@nestjs/common';
import { EnforcementService } from './enforcement.service.js';

// The DB handle and the audit service are both global, so this module only has to provide and
// export the service. The controller that drives it lives in the containment module, because
// pausing releases live containments and so needs the containment service too.
@Module({
  providers: [EnforcementService],
  exports: [EnforcementService],
})
export class EnforcementModule {}
