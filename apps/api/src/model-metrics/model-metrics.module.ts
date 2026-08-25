import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ModelMetricsController } from './model-metrics.controller.js';
import { ModelMetricsService } from './model-metrics.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ModelMetricsController],
  providers: [ModelMetricsService],
})
export class ModelMetricsModule {}
