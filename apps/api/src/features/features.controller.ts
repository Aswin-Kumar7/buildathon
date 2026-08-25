import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  featureEntityResponseSchema,
  featureRankResponseSchema,
  type FeatureEntityResponse,
  type FeatureRankResponse,
} from '@sentinel/contracts';
import type { EntityKind } from '@sentinel/detect';
import { FeaturesService, type Source } from './features.service.js';
import { SessionGuard } from '../auth/session.guard.js';

const KINDS: readonly EntityKind[] = ['session', 'device', 'network'];
const SOURCES: readonly Source[] = ['razorpay', 'replay', 'all'];

function entityKind(raw: string): EntityKind {
  return KINDS.includes(raw as EntityKind) ? (raw as EntityKind) : 'session';
}

function sourceOf(raw: string | undefined): Source {
  return raw !== undefined && SOURCES.includes(raw as Source) ? (raw as Source) : 'all';
}

/**
 * Behind the session guard, like attempts. A feature vector is a description of a shopper's
 * behaviour; pseudonymised or not, it is not something to hand out unauthenticated.
 *
 * Both responses are parsed through the contract on the way out rather than merely typed as
 * it. `@sentinel/detect` and `@sentinel/contracts` are separate packages that can drift, and
 * a drift caught here fails a test instead of rendering as a plausible wrong number.
 */
@Controller('features')
@UseGuards(SessionGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get(':entityKind')
  async rank(
    @Param('entityKind') kind: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ): Promise<FeatureRankResponse> {
    const parsed = Number(limit);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;

    return featureRankResponseSchema.parse(
      await this.features.rank(entityKind(kind), bounded, sourceOf(source)),
    );
  }

  @Get(':entityKind/:entityKey')
  async one(
    @Param('entityKind') kind: string,
    @Param('entityKey') entityKey: string,
    @Query('source') source?: string,
  ): Promise<FeatureEntityResponse> {
    const vector = await this.features.forEntity(entityKind(kind), entityKey, sourceOf(source));
    return featureEntityResponseSchema.parse({ vector });
  }
}
