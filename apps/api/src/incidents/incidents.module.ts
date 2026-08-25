import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FeaturesModule } from '../features/features.module.js';
import { IncidentsController } from './incidents.controller.js';
import { IncidentsService } from './incidents.service.js';
import { ComparisonService } from './comparison.service.js';

@Module({
  imports: [AuthModule, FeaturesModule],
  controllers: [IncidentsController],
  providers: [IncidentsService, ComparisonService],
  exports: [IncidentsService, ComparisonService],
})
export class IncidentsModule {}
