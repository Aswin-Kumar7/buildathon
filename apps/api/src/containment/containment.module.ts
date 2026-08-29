import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FeaturesModule } from '../features/features.module.js';
import { EnforcementModule } from '../enforcement/enforcement.module.js';
import { EnforcementController } from '../enforcement/enforcement.controller.js';
import { ContainmentController } from './containment.controller.js';
import { ContainmentService } from './containment.service.js';
import { ExpiryService } from './expiry.service.js';
import { SimulationService } from './simulation.service.js';

@Module({
  imports: [AuthModule, FeaturesModule, EnforcementModule],
  controllers: [ContainmentController, EnforcementController],
  providers: [ContainmentService, ExpiryService, SimulationService],
  exports: [ContainmentService],
})
export class ContainmentModule {}
