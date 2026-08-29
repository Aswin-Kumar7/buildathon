import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller.js';
import { ModelMetricsService } from '../model-metrics/model-metrics.service.js';

@Module({ controllers: [MetaController], providers: [ModelMetricsService] })
export class MetaModule {}
