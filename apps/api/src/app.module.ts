import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { MetaModule } from './meta/meta.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { AttemptsModule } from './attempts/attempts.module.js';
import { ReplayModule } from './replay/replay.module.js';
import { FeaturesModule } from './features/features.module.js';
import { IncidentsModule } from './incidents/incidents.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { ContainmentModule } from './containment/containment.module.js';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';

// The filter is registered here rather than in main.ts so tests boot the same wiring the
// server does. A guard or filter that exists only in the bootstrap path is one the suite
// silently never exercises.
@Module({
  imports: [
    DbModule,
    HealthModule,
    MetaModule,
    AuthModule,
    OrdersModule,
    WebhooksModule,
    AttemptsModule,
    ReplayModule,
    FeaturesModule,
    IncidentsModule,
    PolicyModule,
    ContainmentModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ZodExceptionFilter }],
})
export class AppModule {}
