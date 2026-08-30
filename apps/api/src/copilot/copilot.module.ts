import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { ContainmentModule } from '../containment/containment.module.js';
import { CopilotController } from './copilot.controller.js';
import { CopilotService } from './copilot.service.js';

/**
 * The incident copilot hangs off incidents (the verified record it grounds every answer on) and auth
 * (the session guard). It reuses the same Groq configuration as the risk manager via the environment.
 */
@Module({
  imports: [AuthModule, IncidentsModule, ContainmentModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
