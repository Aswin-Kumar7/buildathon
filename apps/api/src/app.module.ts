import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { MetaModule } from './meta/meta.module.js';

@Module({ imports: [HealthModule, MetaModule] })
export class AppModule {}
