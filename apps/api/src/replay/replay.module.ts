import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { ReplayController } from './replay.controller.js';
import { ReplayService } from './replay.service.js';
import { SimulationController } from './simulation.controller.js';
import { SimulationService } from './simulation.service.js';

@Module({
  imports: [AuthModule, IncidentsModule, WebhooksModule],
  controllers: [ReplayController, SimulationController],
  providers: [ReplayService, SimulationService],
  exports: [ReplayService, SimulationService],
})
export class ReplayModule {}
