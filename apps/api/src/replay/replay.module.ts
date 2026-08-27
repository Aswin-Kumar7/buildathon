import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { ReplayController } from './replay.controller.js';
import { ReplayService } from './replay.service.js';

@Module({
  imports: [AuthModule, IncidentsModule, WebhooksModule],
  controllers: [ReplayController],
  providers: [ReplayService],
  exports: [ReplayService],
})
export class ReplayModule {}
