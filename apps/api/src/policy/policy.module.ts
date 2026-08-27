import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service.js';
import { PolicyWorkflowController } from './policy-workflow.controller.js';
import { PolicyWorkflowService } from './policy-workflow.service.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * Global because everything that can affect a customer needs the same policy, and passing it
 * around by hand is how two parts of a system end up disagreeing about what is allowed.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PolicyWorkflowController],
  providers: [PolicyService, PolicyWorkflowService],
  exports: [PolicyService, PolicyWorkflowService],
})
export class PolicyModule {}
