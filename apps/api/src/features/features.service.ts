import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { canonicalEvents, checkoutSessions, type DbHandle } from '@sentinel/db';
import {
  computeFeatures,
  DEFAULT_WINDOW,
  type EntityKind,
  type FeatureVector,
  type Observation,
} from '@sentinel/detect';
import { DB } from '../db/db.module.js';

/**
 * How many events to read. A bound on work, not on time.
 *
 * Deliberately not a "last N minutes" filter. Replayed scenarios carry the timestamps they
 * were recorded with, which may be months old, and a clock-anchored query would silently
 * return nothing for them — an empty inspector that looks like a bug in the detector rather
 * than a mismatch between two definitions of "recent". The feature window does the time
 * filtering, from an `asOf` chosen below.
 */
const READ_LIMIT = 20_000;

/** Where `asOf` came from. Reported, because it changes how the numbers should be read. */
export type AsOfBasis = 'now' | 'last-activity';

export interface RankedFeatures {
  candidates: number;
  vectors: FeatureVector[];
  asOf: number;
  generatedAt: number;
  newestObservationAt: number | null;
  basis: AsOfBasis;
  source: Source;
}

export type Source = 'razorpay' | 'replay' | 'all';

@Injectable()
export class FeaturesService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Canonical events joined to the checkout context, as the flat shape features read.
   *
   * The join is on the order id — the only key both halves share, and the reason the storefront
   * records anything at all. Without it there are no correlations to compute, because a
   * Razorpay webhook carries no session, device or address.
   */
  private async observations(source: Source): Promise<Observation[]> {
    const rows = await this.handle.db
      .select({ event: canonicalEvents, checkout: checkoutSessions })
      .from(canonicalEvents)
      .leftJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .orderBy(desc(canonicalEvents.eventAt))
      .limit(READ_LIMIT);

    return rows
      .filter(({ event }) => source === 'all' || event.source === source)
      .map(({ event, checkout }) => ({
        at: event.eventAt.getTime(),
        razorpayOrderId: event.razorpayOrderId ?? '',
        razorpayPaymentId: event.razorpayPaymentId,
        outcome:
          event.status === 'captured'
            ? ('captured' as const)
            : event.status === 'failed'
              ? ('failed' as const)
              : event.status === 'authorized'
                ? ('authorized' as const)
                : ('other' as const),
        amountPaise: event.amountPaise,
        cardId: event.cardId,
        errorSource: event.errorSource,
        errorReason: event.errorReason,
        sessionPseudonym: checkout?.sessionPseudonym ?? null,
        devicePseudonym: checkout?.devicePseudonym ?? null,
        ipPseudonym: checkout?.ipPseudonym ?? null,
        userAgentFamily: checkout?.userAgentFamily ?? null,
      }));
  }

  /**
   * The moment to evaluate as of.
   *
   * Normally now — that is what a live detector means by a rate. But if nothing has happened
   * within a whole window, evaluating as of now yields a page of zeros that says nothing about
   * the traffic that does exist. In that case it evaluates as of the last thing that happened
   * and reports that it did, so the reader knows they are looking at history rather than at a
   * quiet present.
   */
  private static resolveAsOf(
    observations: readonly Observation[],
    windowMs: number,
  ): { asOf: number; generatedAt: number; newest: number | null; basis: AsOfBasis } {
    const generatedAt = Date.now();
    const newest = observations.length === 0 ? null : Math.max(...observations.map((o) => o.at));

    const stale = newest !== null && generatedAt - newest > windowMs;
    return {
      asOf: stale ? newest : generatedAt,
      generatedAt,
      newest,
      basis: stale ? 'last-activity' : 'now',
    };
  }

  private static keysFor(
    observations: readonly Observation[],
    entityKind: EntityKind,
  ): Set<string> {
    const keys = new Set<string>();
    for (const observation of observations) {
      const key =
        entityKind === 'session'
          ? observation.sessionPseudonym
          : entityKind === 'device'
            ? observation.devicePseudonym
            : observation.ipPseudonym;
      if (key !== null && key !== '') keys.add(key);
    }
    return keys;
  }

  /**
   * Feature vectors for every entity with recent activity.
   *
   * Two passes on purpose. The first computes without confirming the sketch counts — cheap,
   * approximate, and enough to rank. The second re-derives the exact counts, but only for the
   * handful that survived the ranking. That is the whole point of allowing a sketch anywhere
   * near a system that can block a payment: approximate to find candidates, exact to decide.
   */
  async rank(entityKind: EntityKind, limit = 20, source: Source = 'all'): Promise<RankedFeatures> {
    const observations = await this.observations(source);
    const { asOf, generatedAt, newest, basis } = FeaturesService.resolveAsOf(
      observations,
      DEFAULT_WINDOW.windowMs,
    );

    const keys = FeaturesService.keysFor(observations, entityKind);

    const discovery = [...keys]
      .map((key) => computeFeatures(entityKind, key, observations, asOf, DEFAULT_WINDOW, false))
      .filter((vector) => vector.attempts > 0)
      // Ranked by what actually needs a human: failures, then how many distinct cards were
      // involved. Neither is a verdict; both are reasons to look.
      .sort(
        (a, b) =>
          b.failures - a.failures ||
          b.distinctCards.estimate - a.distinctCards.estimate ||
          b.attempts - a.attempts,
      )
      .slice(0, limit);

    const vectors = discovery.map((vector) =>
      computeFeatures(entityKind, vector.entityKey, observations, asOf, DEFAULT_WINDOW, true),
    );

    return {
      candidates: keys.size,
      vectors,
      asOf,
      generatedAt,
      newestObservationAt: newest,
      basis,
      source,
    };
  }

  async forEntity(
    entityKind: EntityKind,
    entityKey: string,
    source: Source = 'all',
  ): Promise<FeatureVector> {
    const observations = await this.observations(source);
    const { asOf } = FeaturesService.resolveAsOf(observations, DEFAULT_WINDOW.windowMs);
    return computeFeatures(entityKind, entityKey, observations, asOf, DEFAULT_WINDOW, true);
  }
}
