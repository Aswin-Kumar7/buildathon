import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LoadService } from './load.service.js';
import { SystemController } from './system.controller.js';

/**
 * The load controller is @Global because shedding is a system-wide decision: narration and model
 * scoring consult the same LoadService the health endpoint reports from, so what the console shows
 * being shed is exactly what is being shed. AuthModule is imported for the guard on the health route.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [SystemController],
  providers: [LoadService],
  exports: [LoadService],
})
export class SystemModule {}
