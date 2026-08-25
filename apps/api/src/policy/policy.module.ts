import { Global, Module } from '@nestjs/common';
import { PolicyService } from './policy.service.js';

/**
 * Global because everything that can affect a customer needs the same policy, and passing it
 * around by hand is how two parts of a system end up disagreeing about what is allowed.
 */
@Global()
@Module({ providers: [PolicyService], exports: [PolicyService] })
export class PolicyModule {}
