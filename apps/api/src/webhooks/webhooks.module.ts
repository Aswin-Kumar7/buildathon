import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WebhooksController } from './webhooks.controller.js';
import { IngestService } from './ingest.service.js';
import { DrainService } from './drain.service.js';
import { WebhookMetricsService } from './metrics.service.js';
import { IncidentsModule } from '../incidents/incidents.module.js';

// AuthModule for the session guard on the metrics route. The delivery endpoint itself is
// unauthenticated by necessity — Razorpay holds no session with us — and is authenticated
// by the HMAC over the body instead.
@Module({
  imports: [AuthModule, IncidentsModule],
  controllers: [WebhooksController],
  providers: [IngestService, DrainService, WebhookMetricsService],
  exports: [IngestService, DrainService, WebhookMetricsService],
})
export class WebhooksModule {}
