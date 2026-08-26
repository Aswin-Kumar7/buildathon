import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  modelMetricsResponseSchema,
  incidentModelResponseSchema,
  modelRegistryResponseSchema,
  type ModelMetricsResponse,
  type IncidentModelResponse,
  type ModelRegistryResponse,
} from '@sentinel/contracts';
import { ModelMetricsService } from './model-metrics.service.js';
import { ModelScoringService } from '../model-scoring/model-scoring.service.js';
import { SessionGuard } from '../auth/session.guard.js';

@Controller('model')
@UseGuards(SessionGuard)
export class ModelMetricsController {
  constructor(
    private readonly metrics: ModelMetricsService,
    private readonly scoring: ModelScoringService,
  ) {}

  @Get('metrics')
  get(): ModelMetricsResponse {
    return modelMetricsResponseSchema.parse(this.metrics.load());
  }

  /**
   * The registry entry for the served model: its version, the hash of the data it trained on, the
   * feature-definition version, and a metrics snapshot. What ties a decision the model informed to
   * the exact model that informed it.
   */
  @Get('incident')
  incident(): IncidentModelResponse {
    return incidentModelResponseSchema.parse(this.metrics.loadIncident());
  }

  @Get('registry')
  registry(): ModelRegistryResponse {
    const entry = this.scoring.registryEntry();
    return modelRegistryResponseSchema.parse(
      entry === null
        ? { available: false, reason: 'No model is loaded. Run `make eval` in ml/models/incident.' }
        : { available: true, registry: entry },
    );
  }
}
