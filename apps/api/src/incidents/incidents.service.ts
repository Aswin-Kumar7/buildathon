import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { incidents, incidentTransitions, users, type DbHandle } from '@sentinel/db';
import {
  bucketize,
  canTransition,
  clusterIncidents,
  detectChange,
  dropDuplicateViews,
  evaluateRules,
  firedRules,
  timeToDetect,
  thresholdHash,
  THRESHOLDS,
  type ChangeResult,
  type EntityKind,
  type Evaluation,
  type Incident as ComputedIncident,
  type IncidentStatus,
} from '@sentinel/detect';
import type { EvaluateResponse, IncidentDetail, IncidentSummary } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { FeaturesService } from '../features/features.service.js';

/** Entity kinds evaluated on every pass. An attacker rotating one is caught by another. */
const KINDS: readonly EntityKind[] = ['session', 'device', 'network'];

/** How many entities per kind get the exact-confirmation pass before rules run against them. */
const CANDIDATES = 40;

type Row = typeof incidents.$inferSelect;

@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly features: FeaturesService,
  ) {}

  /**
   * Recomputes incidents from current features.
   *
   * Deliberately a whole pass rather than an incremental update on each event. The features it
   * reads are already point-in-time, so a pass is reproducible, and an incident that exists
   * only because of the order events happened to be processed in is an incident nobody can
   * explain. Cheap enough at this scale to prefer the version that can be re-run.
   */
  async evaluate(source: 'razorpay' | 'replay' | 'all' = 'all'): Promise<EvaluateResponse> {
    const hash = thresholdHash();
    let evaluated = 0;
    let opened = 0;
    let updated = 0;
    // The moment this pass is judging as of. Not a clock read: a replayed scenario carries the
    // timestamps it was recorded with, and expiring against wall-clock time would close every
    // incident the instant it opened — which is exactly what it did before this existed.
    let asOf = 0;

    const found: ComputedIncident[] = [];
    for (const kind of KINDS) {
      const ranked = await this.features.rank(kind, CANDIDATES, source);
      if (ranked.vectors.length === 0) continue;
      evaluated += ranked.vectors.length;
      asOf = Math.max(asOf, ranked.asOf);

      const evaluations: Evaluation[] = ranked.vectors.map((vector) => ({
        vector,
        outcomes: evaluateRules(vector),
        at: ranked.asOf,
      }));
      found.push(...clusterIncidents(evaluations));
    }

    // One machine has one session, one device and one network, so evaluating all three kinds
    // finds the same burst three times. Three rows for one thing is the same failure as sixty
    // alerts for one burst, just smaller — the analyst still has to work out they are the same.
    for (const computed of dropDuplicateViews(found)) {
      const change = this.changeFor(computed, asOf);
      const wrote = await this.upsert(computed, change, hash, source);
      if (wrote === 'opened') opened += 1;
      else updated += 1;
    }

    return {
      evaluated,
      opened,
      updated,
      expired: await this.expireIdle(asOf === 0 ? Date.now() : asOf),
    };
  }

  /**
   * Change detection over this entity's own minute series.
   *
   * Reported beside the rules rather than folded into the score. The two answer different
   * questions — "is this above a threshold" and "has this changed" — and a reader deciding
   * whether to act deserves to see which one spoke.
   */
  private changeFor(computed: ComputedIncident, asOf: number): ChangeResult | null {
    const from = computed.firstAttemptAt - THRESHOLDS.incidentIdleMs;
    if (asOf <= from) return null;

    // Only the entity's own attempts, so the baseline is what normal looked like for it.
    const series = bucketize([computed.firstAttemptAt, computed.lastActivityAt], from, asOf);
    return series.length > 0 ? detectChange(series) : null;
  }

  /**
   * Writes an incident, or folds a re-evaluation into the row that already describes it.
   *
   * Keyed on the computed key, which is derived from the entity and when its activity began.
   * That is what keeps one burst to one row: a second pass over the same episode updates it
   * rather than filling the queue with the same thing seen again.
   *
   * Status is never touched here. A pass that reset an analyst's `under_review` back to `open`
   * would quietly undo their work every time the detector ran.
   */
  private async upsert(
    computed: ComputedIncident,
    change: ChangeResult | null,
    hash: string,
    source: 'razorpay' | 'replay' | 'all',
  ): Promise<'opened' | 'updated'> {
    const values = {
      key: computed.key,
      entityKind: computed.entityKind,
      entityKey: computed.entityKey,
      severity: computed.severity,
      score: computed.score.value,
      scoreLower: computed.score.lower,
      scoreUpper: computed.score.upper,
      band: computed.score.band,
      evidence: computed.score.evidence,
      abstentions: computed.score.abstentions,
      change,
      source: source === 'replay' ? ('replay' as const) : ('razorpay' as const),
      firstAttemptAt: new Date(computed.firstAttemptAt),
      detectedAt: new Date(computed.detectedAt),
      lastActivityAt: new Date(computed.lastActivityAt),
      expiresAt: new Date(computed.expiresAt),
      observations: computed.observations,
      thresholdHash: hash,
    };

    const [existing] = await this.handle.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(eq(incidents.key, computed.key))
      .limit(1);

    if (existing === undefined) {
      await this.handle.db.insert(incidents).values(values).onConflictDoNothing();
      return 'opened';
    }

    // `key`, `firstAttemptAt` and `detectedAt` are deliberately absent. They are facts about
    // this episode that later activity cannot change — moving `detectedAt` would rewrite
    // time-to-detect every time the detector ran.
    await this.handle.db
      .update(incidents)
      .set({
        entityKind: values.entityKind,
        entityKey: values.entityKey,
        severity: values.severity,
        score: values.score,
        scoreLower: values.scoreLower,
        scoreUpper: values.scoreUpper,
        band: values.band,
        evidence: values.evidence,
        abstentions: values.abstentions,
        change: values.change,
        source: values.source,
        lastActivityAt: values.lastActivityAt,
        expiresAt: values.expiresAt,
        observations: values.observations,
        thresholdHash: values.thresholdHash,
        updatedAt: sql`now()`,
      })
      .where(eq(incidents.id, existing.id));

    return 'updated';
  }

  /**
   * Closes incidents nothing has happened on.
   *
   * Automatic and one-way, and recorded with a null actor because the system did it. An
   * incident that stayed open because nobody got to it is how a queue becomes something people
   * stop opening.
   *
   * Measured against the moment the pass judged as of, never against `now()`. Those are the
   * same thing for live traffic and months apart for a replayed scenario, and using the clock
   * meant every replayed incident was born expired — and therefore unmovable, since `expired`
   * is terminal. The analyst saw a queue of things they could not act on.
   */
  private async expireIdle(asOf: number): Promise<number> {
    const stale = await this.handle.db
      .select({ id: incidents.id, status: incidents.status })
      .from(incidents)
      .where(
        and(
          inArray(incidents.status, ['open', 'under_review']),
          sql`${incidents.expiresAt} < ${new Date(asOf)}`,
        ),
      );

    for (const row of stale) {
      await this.handle.db
        .update(incidents)
        .set({ status: 'expired', updatedAt: sql`now()` })
        .where(eq(incidents.id, row.id));

      await this.handle.db.insert(incidentTransitions).values({
        incidentId: row.id,
        fromStatus: row.status,
        toStatus: 'expired',
        note: 'no activity within the idle window',
      });
    }

    return stale.length;
  }

  async list(
    status?: IncidentStatus,
    source?: 'razorpay' | 'replay',
  ): Promise<{
    incidents: IncidentSummary[];
    counts: Record<string, number>;
  }> {
    // Scoped the same way the health page and the feature inspector are. A replayed incident
    // is not evidence the system works against Razorpay, so the two are never pooled silently.
    const filters = [
      status === undefined ? undefined : eq(incidents.status, status),
      source === undefined ? undefined : eq(incidents.source, source),
    ].filter((f) => f !== undefined);

    const rows = await this.handle.db
      .select()
      .from(incidents)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(incidents.severity), desc(incidents.detectedAt))
      .limit(200);

    const all = await this.handle.db
      .select({ status: incidents.status, count: sql<number>`count(*)::int` })
      .from(incidents)
      .groupBy(incidents.status);

    const counts = { open: 0, underReview: 0, contained: 0, resolved: 0, expired: 0 };
    for (const { status: key, count } of all) {
      if (key === 'under_review') counts.underReview = Number(count);
      else counts[key as keyof typeof counts] = Number(count);
    }

    return { incidents: rows.map((row) => IncidentsService.toSummary(row)), counts };
  }

  async detail(id: string): Promise<IncidentDetail> {
    const [row] = await this.handle.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1);
    if (row === undefined) throw new NotFoundException('no such incident');

    const history = await this.handle.db
      .select({
        from: incidentTransitions.fromStatus,
        to: incidentTransitions.toStatus,
        note: incidentTransitions.note,
        at: incidentTransitions.at,
        actor: users.displayName,
      })
      .from(incidentTransitions)
      .leftJoin(users, eq(users.id, incidentTransitions.actorId))
      .where(eq(incidentTransitions.incidentId, id))
      .orderBy(incidentTransitions.at);

    return {
      ...IncidentsService.toSummary(row),
      evidence: row.evidence as IncidentDetail['evidence'],
      abstentions: row.abstentions as IncidentDetail['abstentions'],
      change: row.change as IncidentDetail['change'],
      thresholdHash: row.thresholdHash,
      history: history.map((entry) => ({
        from: entry.from,
        to: entry.to,
        actor: entry.actor,
        note: entry.note,
        at: entry.at.getTime(),
      })),
    };
  }

  /**
   * Moves an incident, recording who did it.
   *
   * The legality of a move is decided by the same pure function the tests exercise, not by a
   * condition written again here. Refusing is a 400 rather than a silent no-op: an analyst who
   * thinks they contained something and did not is worse off than one who got an error.
   */
  async transition(
    id: string,
    to: IncidentStatus,
    actorId: string,
    note?: string,
  ): Promise<IncidentDetail> {
    const [row] = await this.handle.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1);
    if (row === undefined) throw new NotFoundException('no such incident');

    if (!canTransition(row.status, to)) {
      throw new BadRequestException(`an incident cannot go from ${row.status} to ${to}`);
    }

    await this.handle.db
      .update(incidents)
      .set({ status: to, updatedAt: sql`now()` })
      .where(eq(incidents.id, id));

    await this.handle.db.insert(incidentTransitions).values({
      incidentId: id,
      fromStatus: row.status,
      toStatus: to,
      actorId,
      ...(note !== undefined && { note }),
    });

    return this.detail(id);
  }

  private static toSummary(row: Row): IncidentSummary {
    const computed = {
      detectedAt: row.detectedAt.getTime(),
      firstAttemptAt: row.firstAttemptAt.getTime(),
      score: { evidence: row.evidence },
    } as unknown as ComputedIncident;

    return {
      id: row.id,
      key: row.key,
      entityKind: row.entityKind as IncidentSummary['entityKind'],
      entityKey: row.entityKey,
      status: row.status,
      severity: row.severity,
      score: row.score,
      scoreLower: row.scoreLower,
      scoreUpper: row.scoreUpper,
      band: row.band as IncidentSummary['band'],
      firstAttemptAt: row.firstAttemptAt.getTime(),
      detectedAt: row.detectedAt.getTime(),
      lastActivityAt: row.lastActivityAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
      timeToDetectMs: timeToDetect(computed),
      observations: row.observations,
      source: row.source,
      firedRules: firedRules(computed),
    };
  }
}
