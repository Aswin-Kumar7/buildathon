import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IncidentsModule } from '../incidents/incidents.module.js';
import { NarrationController } from './narration.controller.js';
import { NarrationService } from './narration.service.js';

/**
 * Narration hangs off incidents: it reads an incident's verified record and turns it into prose.
 * IncidentsModule supplies that record; AuthModule supplies the guard on the controller.
 */
@Module({
  imports: [IncidentsModule, AuthModule],
  controllers: [NarrationController],
  providers: [NarrationService],
  exports: [NarrationService],
})
export class NarrationModule {}
