import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  canonicalEvents,
  checkoutSessions,
  incidents,
  incidentTransitions,
  users,
  type DbHandle,
} from '@sentinel/db';
import {
  arbitrate,
  arbitrationExplainsBenign,
  bucketize,
  canTransition,
  combineDecision,
  computeTraffic,
  DEFAULT_CHANGE_OPTIONS,
  clusterIncidents,
  detectChange,
  dropDuplicateViews,
  evaluateRules,
  firedRules,
  incidentFeatures,
  incidentTitle,
  INCIDENT_FEATURE_NAMES,
  incidentKey,
  severityOf,
  timeToDetect,
  thresholdHash,
  THRESHOLDS,
  type Score,
  type ChangeResult,
  type EntityKind,
  type Evaluation,
  type Arbitration,
  type FeatureVector,
  type ModelInfluence,
  type ModelVerdict,
  type TrafficContext,
  type Incident as ComputedIncident,
  type IncidentStatus,
  type Observation,
} from '@sentinel/detect';
import { SHOP_WIDE_ENTITY_KEY } from '@sentinel/contracts';
import type {
  EvaluateResponse,
  IncidentDetail,
  IncidentGraph,
  IncidentSummary,
  ModelOpinion,
} from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { FeaturesService, type EventSource } from '../features/features.service.js';
import { AuditService } from '../audit/audit.service.js';
import { performance } from 'node:perf_hooks';
import { ModelScoringService } from '../model-scoring/model-scoring.service.js';
import { LoadService } from '../system/load.service.js';
import { AttemptsService } from '../attempts/attempts.service.js';

/** A short, distinctive label for a pseudonym or token id in the incident graph — never the value. */
function graphFingerprint(value: string): string {
  return value.replace(/^v\d+:/, '').slice(-8);
}

/** Entity kinds evaluated on every pass. An attacker rotating one is caught by another. */
const KINDS: readonly EntityKind[] = ['session', 'device', 'network'];

/** How many entities per kind get the exact-confirmation pass before rules run against them. */
const CANDIDATES = 40;

/**
 * The trigger-rate cap on model scoring. The model runs only on entities that became incidents —
 * never on every event — and even then no more than this many per pass, so a burst cannot turn the
 * scorer into an unbounded cost. Beyond the cap an incident simply carries no model opinion, which
 * the console shows as "not scored" rather than pretending to one.
 */
const MAX_SCORED_PER_PASS = 100;

/**
 * The shop-wide fraud-spike gate: when the rules open nothing but the shop *as a whole* is
 * unmistakably card testing, one aggregate incident is raised on the merchant. This is the only thing
 * that catches a genuinely distributed attack — sprayed so thin across sessions and addresses that no
 * single entity trips a per-entity threshold, and no single entity is dense enough for the model to
 * score with confidence either.
 *
 * Two things must always hold, and then one of two signals:
 *
 * - `MIN_ATTEMPTS`: enough volume to be real, not a two-transaction blip.
 * - `INFRA_MAX`: not a gateway outage — an outage spreads failures across everyone too, but they are
 *   gateway-blamed, not card declines.
 *
 * and then EITHER a shop-wide approval collapse OR a card-testing cohort:
 *
 * - approval collapse — `APPROVAL_FLOOR` + `CARD_SPREAD` + `MIN_FAILING_SESSIONS`: captures collapsed
 *   to near nothing across many distinct cards and many sessions. Cheap and sufficient when the window
 *   holds little else, but a legitimate surge sharing the same thirty-minute window inflates the
 *   shop-wide approval rate and hides the collapse — which is exactly the case the cohort exists for.
 * - card-testing cohort — `MIN_TESTING_SESSIONS`: enough sessions that only ever failed, across two or
 *   more distinct cards, and not gateway-blamed. A surge keeps approving its own shoppers, so they
 *   never join this cohort and cannot dilute it; a lone declined shopper walks one card, not two; an
 *   outage is gateway-blamed. This is what keeps a distributed attack visible next to a flash sale.
 */
const SHOP_APPROVAL_FLOOR = 0.1;
const SHOP_CARD_SPREAD = 15;
const SHOP_MIN_FAILING_SESSIONS = 5;
const SHOP_INFRA_MAX = 0.3;
const SHOP_MIN_ATTEMPTS = 15;
const SHOP_MIN_TESTING_SESSIONS = 5;

type Row = typeof incidents.$inferSelect;
type Source = 'razorpay' | 'replay' | 'all';

/** Arbitration as it is stored, carrying how the model moved the decision. */
type StoredArbitration = Arbitration & { modelInfluence?: ModelInfluence };

/** The exact counts the queue and overview display, taken straight from the feature vector. */
type IncidentCounts = { attempts: number; failures: number; distinctCards: number | null };

/** Reads the display counts off a feature vector, the one place they are already exact. */
function countsOf(vector: FeatureVector | undefined): IncidentCounts | null {
  return vector === undefined
    ? null
    : {
        attempts: vector.attempts,
        failures: vector.failures,
        distinctCards: vector.distinctCards.exact,
      };
}

@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly features: FeaturesService,
    private readonly audit: AuditService,
    private readonly scoring: ModelScoringService,
    private readonly load: LoadService,
    private readonly attempts: AttemptsService,
  ) {}

  /**
   * Recomputes incidents from current features.
   *
   * Deliberately a whole pass rather than an incremental update on each event. The features it
   * reads are already point-in-time, so a pass is reproducible, and an incident that exists
   * only because of the order events happened to be processed in is an incident nobody can
   * explain. Cheap enough at this scale to prefer the version that can be re-run.
   */
  // The orchestration intentionally owns the full decision lifecycle in one pass.
  // eslint-disable-next-line complexity
  async evaluate(source: Source = 'all'): Promise<EvaluateResponse> {
    const hash = thresholdHash();
    let evaluated = 0;
    let opened = 0;
    let updated = 0;
    // The moment this pass is judging as of. Not a clock read: a replayed scenario carries the
    // timestamps it was recorded with, and expiring against wall-clock time would close every
    // incident the instant it opened — which is exactly what it did before this existed.
    let asOf = 0;

    const found: ComputedIncident[] = [];
    const provenance = new Map<string, EventSource>();
    // Kept so each incident can be arbitrated against the vector it was actually opened on.
    const vectors = new Map<string, FeatureVector>();
    let observations: Observation[] = [];

    for (const kind of KINDS) {
      const fetchStart = performance.now();
      const ranked = await this.features.rank(kind, CANDIDATES, source);
      this.load.recordFeatureFetch(performance.now() - fetchStart);
      if (ranked.vectors.length === 0) continue;
      evaluated += ranked.vectors.length;
      asOf = Math.max(asOf, ranked.asOf);
      observations = ranked.observations;
      for (const [key, from] of ranked.provenance) provenance.set(key, from);

      const evaluations: Evaluation[] = ranked.vectors.map((vector) => {
        vectors.set(`${kind}:${vector.entityKey}`, vector);
        return { vector, outcomes: evaluateRules(vector), at: ranked.asOf };
      });
      found.push(...clusterIncidents(evaluations));
    }

    const change = IncidentsService.changeAcrossTraffic(observations, asOf);
    // Computed once: it describes the shop, not any one entity, and every incident in this pass
    // is judged against the same picture of it.
    const traffic = computeTraffic(observations, asOf);

    // One machine has one session, one device and one network, so evaluating all three kinds
    // finds the same burst three times. Three rows for one thing is the same failure as sixty
    // alerts for one burst, just smaller — the analyst still has to work out they are the same.
    let scored = 0;
    // Entities the rule tier already spoke for this pass, so the model-only pass below does not
    // open a second case for one that rules and arbitration already judged.
    const handled = new Set<string>();
    const ruleIncidents = dropDuplicateViews(found);
    for (const computed of ruleIncidents) {
      const entityId = `${computed.entityKind}:${computed.entityKey}`;
      handled.add(entityId);
      const vector = vectors.get(entityId);
      const arbitration = vector === undefined ? null : arbitrate(vector, traffic);

      // Trigger only, and capped. The exact counts are already confirmed on these vectors, which
      // is the precondition for letting a model near a decision at all.
      const opinion = this.scoreWhenWarranted(vector, traffic, scored);
      if (opinion !== null) scored += 1;

      // The model is a driver, not a passenger. Arbitration decides from the rules; the model's
      // verdict then combines with it — escalating a case the rules would have suppressed, or
      // downgrading a containment it disputes — bounded so it never blocks a shopper on its own and
      // is ignored the moment it abstains or is absent (the degraded:model path). An outage, a
      // biller's schedule or an ordinary busy afternoon are still explanations that argue against
      // putting anyone in front of a person, and existing incidents are updated so one that has
      // since explained itself says so rather than going stale.
      const decided = IncidentsService.decide(arbitration, opinion);
      const wanted = decided === null || ['contain', 'review'].includes(decided.decision);
      const exactExists = await this.exists(computed.key);
      if (!wanted && !exactExists) continue;

      const eventSource = provenance.get(computed.entityKey) ?? 'razorpay';
      // Re-evaluations can see the same burst through a different correlation key. Preserve the
      // first canonical incident instead of adding a second row merely because its entity view
      // changed between passes.
      if (!exactExists && (await this.hasSameActivity(computed, eventSource))) continue;

      const wrote = await this.upsert(
        computed,
        change,
        hash,
        eventSource,
        decided,
        opinion,
        vector === undefined ? null : IncidentsService.featuresObject(vector, traffic),
        countsOf(vector),
      );
      if (wrote === 'opened') opened += 1;
      else updated += 1;
    }

    // Shop-level fraud spike — the one detector that catches a genuinely distributed attack. When it
    // is sprayed thin across many sessions and addresses, no single entity trips a per-entity rule and
    // none is dense enough for the model to score with confidence, so both the rule tier and a
    // per-entity model pass go silent. The shop-wide aggregate does not: many distinct cards, captures
    // collapsed to near zero, failures spread across many sessions. This raises one incident on the
    // merchant when the rules found nothing and that aggregate is unmistakable — deterministic, so it
    // is reliable rather than dependent on a thin per-entity score, and gated (see SHOP_*) so a sale,
    // a biller's dunning or an outage never trip it.
    const spike = await this.raiseShopSpike({
      traffic,
      ruleIncidents,
      change,
      hash,
      source,
      asOf,
      observations,
      // Every entity's own explanation, so the shop-wide pass can be overruled the same way a
      // per-entity case is. Computed here rather than inside, because the loop above only
      // arbitrates entities that produced a rule incident — and this pass runs precisely when
      // there were none.
      explanations: [...vectors.values()].map((vector) => arbitrate(vector, traffic).best),
    });
    opened += spike.opened;
    updated += spike.updated;

    return {
      evaluated,
      opened,
      updated,
      // Close what has explained itself benign; a positive re-explanation, never mere silence.
      deescalated: await this.deescalateExplained(vectors, traffic, handled, source, asOf),
      // Incidents no longer expire on idle. An incident stays open until a person acts on it, so
      // nothing a merchant hasn't seen is closed out from under them. Benign cases are still stood
      // down above (a positive re-explanation) — but silence alone never closes an incident.
      expired: 0,
    };
  }

  /**
   * Whether the shop as a whole looks like card testing. Enough volume and not a gateway outage
   * always, and then either the shop-wide approval collapsed (cheap, but a legitimate surge sharing
   * the window hides it) or a cohort of sessions only ever failed across many fresh cards
   * (dilution-proof — a surge keeps approving, so it never joins the cohort). The ordinary shapes each
   * fail a clause: a sale keeps approving (no collapse) and its shoppers succeed (no cohort), dunning
   * reuses a handful of cards (fails CARD_SPREAD and the two-card cohort test), an outage is
   * gateway-blamed (fails INFRA_MAX and is dropped from the cohort).
   */
  /**
   * Whether the shop's own traffic already explains itself innocently.
   *
   * The per-entity path cannot open a case that arbitration positively explains as an outage, a
   * biller retrying, or an ordinary busy hour. The shop-wide pass used to skip that check entirely
   * and decide on thresholds alone, so a benign burst with enough volume — a sale, a wave of
   * mistyped cards — opened a "Distributed card testing" incident that no hypothesis could argue
   * against. Now the same explanations get the same veto.
   *
   * A simple majority, and `insufficient_evidence` deliberately does not count toward it. That is
   * the signature of the case this pass exists for: an attack sprayed so thin that no single entity
   * carries enough signal to decide, which is a reason to look, not a reason to stand down.
   */
  private static shopExplainedBenignly(explanations: readonly string[]): boolean {
    if (explanations.length === 0) return false;
    const benign = explanations.filter((best) => arbitrationExplainsBenign(best)).length;
    return benign * 2 > explanations.length;
  }

  private static shopUnderCardTesting(t: TrafficContext): boolean {
    const enoughVolume = t.attempts >= SHOP_MIN_ATTEMPTS;
    const notOutage = t.infrastructureFailureShare <= SHOP_INFRA_MAX;
    const approvalCollapse =
      t.approvalRate <= SHOP_APPROVAL_FLOOR &&
      t.distinctCards >= SHOP_CARD_SPREAD &&
      t.failingSessions >= SHOP_MIN_FAILING_SESSIONS;
    const enumerationCohort = t.cardTestingSessions >= SHOP_MIN_TESTING_SESSIONS;
    return enoughVolume && notOutage && (approvalCollapse || enumerationCohort);
  }

  /**
   * The shop-wide fraud-spike pass: one aggregate incident when the rules opened nothing yet the
   * merchant as a whole is unmistakably under card testing. This is what makes a distributed attack —
   * sprayed too thin for any per-entity signal — reliably visible, without ever second-guessing a
   * legitimate shop. Keyed on a synthetic `network:shop` entity anchored at the window's earliest
   * attempt, so re-evaluation updates the one incident rather than opening a new one each pass.
   */
  private async raiseShopSpike(ctx: {
    traffic: TrafficContext;
    ruleIncidents: readonly ComputedIncident[];
    change: ChangeResult | null;
    hash: string;
    source: Source;
    asOf: number;
    observations: Observation[];
    explanations: readonly string[];
  }): Promise<{ opened: number; updated: number }> {
    const { traffic, ruleIncidents, change, hash, source, asOf, observations, explanations } = ctx;
    // Only when the rules found nothing this pass: a dense attack they already caught is not a
    // shop-wide miss, and a second aggregate case over it would double-count.
    if (ruleIncidents.length > 0) return { opened: 0, updated: 0 };
    if (!IncidentsService.shopUnderCardTesting(traffic)) return { opened: 0, updated: 0 };
    if (IncidentsService.shopExplainedBenignly(explanations)) return { opened: 0, updated: 0 };

    const firstAttemptAt =
      observations.length > 0 ? Math.min(...observations.map((o) => o.at)) : asOf;
    // The score is the collapse in approval among the sessions that failed — near-zero captures there
    // is near-certain enumeration. Deliberately NOT the shop-wide approval rate: a legitimate surge
    // in the same window would soften that and read a real spike as low severity. A point estimate,
    // so the band is `high` and severity reads off it directly.
    const score = IncidentsService.modelRiskScore(1 - traffic.failingSessionApprovalRate);
    const incident: ComputedIncident = {
      key: incidentKey('network', SHOP_WIDE_ENTITY_KEY, firstAttemptAt),
      entityKind: 'network',
      entityKey: SHOP_WIDE_ENTITY_KEY,
      status: 'open',
      severity: severityOf(score),
      score,
      firstAttemptAt,
      detectedAt: asOf,
      lastActivityAt: asOf,
      expiresAt: asOf + THRESHOLDS.incidentIdleMs,
      observations: 1,
      attempts: traffic.attempts,
      change: change ?? null,
    };
    const src: EventSource = source === 'replay' ? 'replay' : 'razorpay';
    // A previous pass may already have persisted this same shop-wide activity — do not open a second.
    if (await this.hasSameActivity(incident, src)) return { opened: 0, updated: 0 };
    // Network kind + an attack hypothesis titles it "Distributed card testing"; sent to review because
    // a ring with no single entity has nothing to contain — a person decides.
    const decided: StoredArbitration = {
      best: 'attack',
      runnerUp: 'insufficient_evidence',
      margin: 1,
      fits: [],
      decision: 'review',
      abstained: false,
      reasons: ['shop_wide_card_testing'],
      modelInfluence: 'flagged',
    };
    const counts: IncidentCounts = {
      attempts: traffic.attempts,
      failures: traffic.failures,
      distinctCards: traffic.distinctCards,
    };
    const wrote = await this.upsert(incident, change, hash, src, decided, null, null, counts);
    return wrote === 'opened' ? { opened: 1, updated: 0 } : { opened: 0, updated: 1 };
  }

  private async hasSameActivity(incident: ComputedIncident, source: EventSource): Promise<boolean> {
    const existing = await this.handle.db
      .select({
        firstAttemptAt: incidents.firstAttemptAt,
        lastActivityAt: incidents.lastActivityAt,
        observations: incidents.observations,
      })
      .from(incidents)
      .where(eq(incidents.source, source));

    return existing.some(
      (row) =>
        row.firstAttemptAt.getTime() === incident.firstAttemptAt &&
        row.lastActivityAt.getTime() === incident.lastActivityAt &&
        row.observations === incident.observations,
    );
  }

  /**
   * The decision actually taken: arbitration's rule-based call, moved by the model's verdict where
   * the model is confident enough to move it. Returns null only when arbitration itself is null (an
   * incident from before arbitration existed), in which case the rules stand alone.
   */
  private static decide(
    arbitration: Arbitration | null,
    opinion: ModelOpinion | null,
  ): StoredArbitration | null {
    if (arbitration === null) return null;
    const combined = combineDecision(arbitration, IncidentsService.verdictOf(opinion));
    return {
      ...arbitration,
      decision: combined.decision,
      reasons: combined.reasons,
      modelInfluence: combined.influence,
    };
  }

  /** The model opinion reduced to the verdict a decision needs: its risk score, P(abuse). */
  private static verdictOf(opinion: ModelOpinion | null): ModelVerdict | null {
    return opinion === null ? null : { risk: opinion.risk };
  }

  /**
   * A score for a case the model raised where no rule fired: its value is the model's P(abuse), band
   * `high` because the model gave a point estimate (nothing abstained), and evidence empty because no
   * rule contributed. This keeps a model-flagged incident's severity and displayed risk honest to what
   * actually raised it, instead of the zero an empty rule sum would produce.
   */
  private static modelRiskScore(risk: number): Score {
    const value = Math.round(Math.min(Math.max(risk, 0), 1) * 1000) / 1000;
    return {
      value,
      lower: value,
      upper: value,
      band: 'high',
      incriminating: value,
      mitigating: 0,
      evidence: [],
      abstentions: [],
    };
  }

  private scoreWhenWarranted(
    vector: FeatureVector | undefined,
    traffic: TrafficContext,
    scoredSoFar: number,
  ): ModelOpinion | null {
    if (vector === undefined || scoredSoFar >= MAX_SCORED_PER_PASS) return null;
    // Model scoring is SHEDDABLE_PLUS: under real load the controller sheds it and the decision runs
    // rules-only (degraded:model), exactly as the degradation matrix requires. The inference time is
    // recorded so the health view can split it out from the feature fetch.
    if (this.load.shouldShed('model_scoring')) return null;
    const start = performance.now();
    const opinion = this.scoring.score(vector, traffic);
    this.load.recordInference(performance.now() - start);
    return opinion;
  }

  /**
   * Change detection across the shop's traffic, once per pass.
   *
   * Across the shop rather than per entity, which is the level the method is actually good for.
   * A session has no history by construction — it did not exist an hour ago — so asking whether
   * it changed can only ever answer "it is new". A merchant's overall arrival rate does have a
   * baseline, and a shift in it is the low-amplitude case a fixed threshold cannot reach, which
   * is the reason CUSUM is here at all.
   *
   * Reported beside the rules rather than folded into the score. "Is this above a threshold"
   * and "has this changed" are different questions, and a reader deciding whether to act
   * deserves to know which one spoke.
   */
  private static changeAcrossTraffic(
    observations: readonly Observation[],
    asOf: number,
  ): ChangeResult | null {
    if (observations.length === 0) return null;

    const from = Math.min(...observations.map((o) => o.at));
    if (asOf <= from) return null;

    const series = bucketize(
      observations.map((o) => o.at),
      from,
      asOf,
    );
    // Fewer buckets than the warm-up means there is no baseline to have departed from, and a
    // detector run on its own warm-up would be reporting on nothing.
    return series.length > DEFAULT_CHANGE_OPTIONS.warmUpBuckets ? detectChange(series) : null;
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
  /** The feature vector as a named object, so a stored incident carries exactly what the model saw. */
  private static featuresObject(
    vector: FeatureVector,
    traffic: TrafficContext,
  ): Record<string, number> {
    const values = incidentFeatures(vector, traffic);
    return Object.fromEntries(INCIDENT_FEATURE_NAMES.map((name, i) => [name, values[i]!]));
  }

  private async upsert(
    computed: ComputedIncident,
    change: ChangeResult | null,
    hash: string,
    source: EventSource,
    arbitration: StoredArbitration | null,
    modelOpinion: ModelOpinion | null,
    features: Record<string, number> | null,
    counts: IncidentCounts | null,
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
      arbitration,
      modelOpinion,
      // The retraining seam: the exact numbers the decision rested on, and the model's risk on them.
      features,
      modelRisk: modelOpinion?.risk ?? null,
      // The display counts, exact from the vector — what the queue and overview show per incident.
      attempts: counts?.attempts ?? null,
      failures: counts?.failures ?? null,
      distinctCards: counts?.distinctCards ?? null,
      // Taken from the events behind this entity, never from the scope that was asked for.
      // Evaluating "both" and labelling the result `razorpay` would present replayed traffic
      // as a real detection — the one thing this system claims it never does.
      source,
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
        arbitration: values.arbitration,
        modelOpinion: values.modelOpinion,
        features: values.features,
        modelRisk: values.modelRisk,
        attempts: values.attempts,
        failures: values.failures,
        distinctCards: values.distinctCards,
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
   *
   * Scoped to the traffic the pass actually looked at, for the same reason. A pass over live
   * traffic carries a wall-clock moment, and applying it to incidents recorded against a
   * replayed scenario's timestamps would expire all of them at once.
   */
  private async exists(key: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(eq(incidents.key, key))
      .limit(1);

    return row !== undefined;
  }

  /**
   * Closes open incidents whose entity has, on this pass, positively re-explained itself as benign.
   *
   * The trigger is a *positive* benign explanation — a biller's dunning, an acquirer outage, an
   * ordinary busy hour — never the mere absence of an attack, so a real attack that briefly went
   * quiet is left to expire as itself rather than mislabelled as legitimate. Scoped to entities this
   * pass actually re-evaluated and did not re-open (`handled`): an entity still tripping the
   * incriminating rules keeps its incident, and one no longer in view is closed by idle expiry, not
   * here. The incident's arbitration is rewritten to the explanation that won, so the detail says why
   * it stood down, and the move is recorded with a null actor because the system, not a person, made it.
   */
  private async deescalateExplained(
    vectors: Map<string, FeatureVector>,
    traffic: TrafficContext,
    handled: Set<string>,
    source: Source,
    asOf: number,
  ): Promise<number> {
    if (asOf === 0) return 0;
    const scoped =
      source === 'all'
        ? undefined
        : eq(incidents.source, source === 'replay' ? 'replay' : 'razorpay');

    const open = await this.handle.db
      .select({
        id: incidents.id,
        status: incidents.status,
        entityKind: incidents.entityKind,
        entityKey: incidents.entityKey,
        thresholdHash: incidents.thresholdHash,
      })
      .from(incidents)
      .where(
        and(
          inArray(incidents.status, ['open', 'under_review']),
          ...(scoped === undefined ? [] : [scoped]),
        ),
      );

    let deescalated = 0;
    for (const row of open) {
      const entityId = `${row.entityKind}:${row.entityKey}`;
      if (handled.has(entityId)) continue;
      const vector = vectors.get(entityId);
      if (vector === undefined) continue;

      const arbitration = arbitrate(vector, traffic);
      if (!arbitrationExplainsBenign(arbitration.best)) continue;

      await this.resolveAsBenign(row, arbitration);
      deescalated += 1;
    }
    return deescalated;
  }

  /** Rewrites an incident to the benign explanation it now has, closes it, and records why. */
  private async resolveAsBenign(
    row: { id: string; status: IncidentStatus; thresholdHash: string },
    arbitration: Arbitration,
  ): Promise<void> {
    const explanation = arbitration.best.replace(/_/g, ' ');
    const note = `re-evaluated as ${explanation} — legitimate activity, not an attack`;

    await this.handle.db
      .update(incidents)
      .set({
        arbitration: arbitration as StoredArbitration,
        status: 'resolved',
        updatedAt: sql`now()`,
      })
      .where(eq(incidents.id, row.id));

    await this.handle.db.insert(incidentTransitions).values({
      incidentId: row.id,
      fromStatus: row.status,
      toStatus: 'resolved',
      note,
    });

    await this.audit.append({
      actorId: null,
      kind: 'incident.transition',
      subjectType: 'incident',
      subjectId: row.id,
      payload: { from: row.status, to: 'resolved', note, explanation: arbitration.best },
      featureSnapshotHash: row.thresholdHash,
    });
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
      arbitration: row.arbitration as IncidentDetail['arbitration'],
      modelOpinion: (row.modelOpinion as IncidentDetail['modelOpinion']) ?? null,
      modelAvailable: this.scoring.available,
      label: row.label ?? null,
      labelSource: row.labelSource ?? null,
      thresholdHash: row.thresholdHash,
      relatedOrders: await this.attempts.listForEntity({
        entityKind: row.entityKind as 'session' | 'device' | 'network',
        entityKey: row.entityKey,
        source: row.source as 'razorpay' | 'replay',
        from: row.firstAttemptAt.getTime(),
        to: row.lastActivityAt.getTime(),
      }),
      graph: await this.entityGraph(
        row.entityKind as 'session' | 'device' | 'network',
        row.entityKey,
        row.source as 'razorpay' | 'replay',
        row.firstAttemptAt,
        row.lastActivityAt,
      ),
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
   * The correlation behind an incident as a small graph: the entity, the distinct cards it touched,
   * and — for a network-level case — the sessions those cards came through. Cards are deduplicated by
   * their token id; each is shown by a short fingerprint, never a real number.
   *
   * A shop-wide incident names no actor, so there is no pseudonym to match and the window alone
   * scopes it. Filtering on the sentinel instead returned an empty graph for exactly the case that
   * most needs one — a distributed attack, whose whole point is that it spans many entities.
   */
  private async entityGraph(
    entityKind: 'session' | 'device' | 'network',
    entityKey: string,
    source: 'razorpay' | 'replay',
    from: Date,
    to: Date,
  ): Promise<IncidentGraph> {
    const shopWide = entityKind === 'network' && entityKey === SHOP_WIDE_ENTITY_KEY;
    const column =
      entityKind === 'session'
        ? checkoutSessions.sessionPseudonym
        : entityKind === 'device'
          ? checkoutSessions.devicePseudonym
          : checkoutSessions.ipPseudonym;

    const rows = await this.handle.db
      .select({
        cardId: canonicalEvents.cardId,
        cardNetwork: canonicalEvents.cardNetwork,
        paymentId: canonicalEvents.razorpayPaymentId,
        status: canonicalEvents.status,
        session: checkoutSessions.sessionPseudonym,
      })
      .from(canonicalEvents)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .where(
        and(
          ...(shopWide ? [] : [eq(column, entityKey)]),
          eq(canonicalEvents.source, source),
          gte(canonicalEvents.eventAt, from),
          lte(canonicalEvents.eventAt, to),
        ),
      );

    const cards = new Map<
      string,
      { network: string | null; payments: Set<string>; captured: boolean }
    >();
    const sessions = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.cardId === null || row.cardId === '') continue;
      const card = cards.get(row.cardId) ?? {
        network: row.cardNetwork,
        payments: new Set<string>(),
        captured: false,
      };
      if (row.paymentId !== null) card.payments.add(row.paymentId);
      if (row.status === 'captured') card.captured = true;
      cards.set(row.cardId, card);
      if (row.session !== null) {
        const set = sessions.get(row.session) ?? new Set<string>();
        set.add(row.cardId);
        sessions.set(row.session, set);
      }
    }

    return {
      entity: { kind: entityKind, fingerprint: graphFingerprint(entityKey) },
      cards: [...cards.entries()].map(([id, card]) => ({
        fingerprint: graphFingerprint(id),
        network: card.network,
        attempts: card.payments.size,
        captured: card.captured,
      })),
      sessions:
        entityKind === 'network'
          ? [...sessions.entries()].map(([id, set]) => ({
              fingerprint: graphFingerprint(id),
              cards: set.size,
            }))
          : [],
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
    verdict?: 'confirmed_abuse' | 'false_positive',
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

    // The label the analyst is confirming. An explicit verdict wins; failing that, containing an
    // incident is itself a statement that it is abuse. Anything else leaves the label untouched, so a
    // routine move (open -> under_review) never fabricates a training example.
    const label =
      verdict === 'confirmed_abuse'
        ? 1
        : verdict === 'false_positive'
          ? 0
          : to === 'contained'
            ? 1
            : null;
    const labelling =
      label === null
        ? {}
        : { label, labelSource: 'analyst', labeledAt: sql`now()`, labeledBy: actorId };

    await this.handle.db
      .update(incidents)
      .set({ status: to, updatedAt: sql`now()`, ...labelling })
      .where(eq(incidents.id, id));

    await this.handle.db.insert(incidentTransitions).values({
      incidentId: id,
      fromStatus: row.status,
      toStatus: to,
      actorId,
      ...(note !== undefined && { note }),
    });

    await this.audit.append({
      actorId,
      kind: 'incident.transition',
      subjectType: 'incident',
      subjectId: id,
      payload: { from: row.status, to, note: note ?? null, ...(label !== null && { label }) },
      featureSnapshotHash: row.thresholdHash,
    });

    return this.detail(id);
  }

  private static toSummary(row: Row): IncidentSummary {
    const computed = {
      detectedAt: row.detectedAt.getTime(),
      firstAttemptAt: row.firstAttemptAt.getTime(),
      score: { evidence: row.evidence },
    } as unknown as ComputedIncident;
    const arbitration = row.arbitration as {
      best?: IncidentSummary['primaryHypothesis'];
      decision?: IncidentSummary['recommendedDecision'];
    } | null;
    const fired = firedRules(computed);
    const primaryHypothesis = arbitration?.best ?? 'insufficient_evidence';

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
      firedRules: fired,
      recommendedDecision: arbitration?.decision ?? 'none',
      primaryHypothesis,
      // Exact counts, captured from the feature vector at evaluation. `observations` is the
      // fallback only for incidents recorded before these columns existed.
      attempts: row.attempts ?? row.observations,
      failures: row.failures ?? 0,
      distinctCards: row.distinctCards ?? null,
      title: incidentTitle({ entityKind: row.entityKind, primaryHypothesis, firedRules: fired }),
    };
  }
}
