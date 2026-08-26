import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  riskModelMetricsResponseSchema,
  modelRegistryResponseSchema,
  type RiskModelMetricsResponse,
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

  /**
   * The deployed card-testing risk model's honest evaluation — the one served in the request path,
   * so the precision/recall/PR-AUC the reader sees describe the model the merchant actually runs.
   */
  @Get('metrics')
  get(): RiskModelMetricsResponse {
    return riskModelMetricsResponseSchema.parse(this.metrics.load());
  }

  /**
   * The registry entry for the served model: its version, the hash of the data it trained on, the
   * feature-definition version, and a metrics snapshot. What ties a decision the model informed to
   * the exact model that informed it.
   */
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
