import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { MetaModule } from './meta/meta.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({ imports: [DbModule, HealthModule, MetaModule, AuthModule] })
export class AppModule {}
