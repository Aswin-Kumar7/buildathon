import { Controller, Get, UseGuards } from '@nestjs/common';
import { modelMetricsResponseSchema, type ModelMetricsResponse } from '@sentinel/contracts';
import { ModelMetricsService } from './model-metrics.service.js';
import { SessionGuard } from '../auth/session.guard.js';

@Controller('model')
@UseGuards(SessionGuard)
export class ModelMetricsController {
  constructor(private readonly metrics: ModelMetricsService) {}

  @Get('metrics')
  get(): ModelMetricsResponse {
    return modelMetricsResponseSchema.parse(this.metrics.load());
  }
}
