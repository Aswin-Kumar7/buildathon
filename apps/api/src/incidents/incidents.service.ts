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
  describesSameActivity,
  detectChange,
  dropDuplicateViews,
  evaluateRules,
  firedRules,
  incidentFeatures,
  incidentTitle,
  INCIDENT_FEATURE_NAMES,
  modelFlagsMissedEntity,
  openIncident,
  severityOf,
  timeToDetect,
  thresholdHash,
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
 * How many model-only cases one pass may raise. A distributed attack is many thin entities the rules
 * missed; without a bound the model would open a row per session and drown the queue it is trying to
 * surface. Capped to the highest-risk few — enough to make the coordinated pattern unmistakable, not
 * one alert per address — and the same top entities re-selected each pass (risk, then key) update in
 * place rather than accumulating.
 */
const MODEL_FLAG_MAX_PER_PASS = 6;

/**
 * The model may only raise a case the rules missed when the shop itself is attack-shaped — captures
 * far below what any honest hour reaches. Approval is the one signal that separates a distributed
 * attack (near-zero) from the things that also spread failures across everyone: a flash sale and a
 * gateway wobble both look "everywhere at once", and both keep approving real shoppers. Without this
 * gate the model's small-sample false positives on a legitimate sale surface as review noise; with it,
 * a healthy or busy shop is never second-guessed, and the per-entity benign veto still handles the
 * low-approval-but-innocent cases (a biller's dunning, an outage) that clear it.
 */
const MODEL_FLAG_APPROVAL_CEILING = 0.4;

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

    // The model on its own — the pass that lets it raise a case the rules never opened. This is the
    // one place the learned model catches what a single-entity burst rule structurally cannot: a
    // distributed attack spread so thin across sessions and addresses that no key trips a threshold.
    // It runs for replay as well as live, so a simulated distributed attack is caught in the demo the
    // same way it would be in production — the whole point of having the model. Duplicate views of one
    // burst are still collapsed below (dropDuplicateViews / describesSameActivity / hasSameActivity),
    // and a confident benign explanation still vetoes it, so enabling replay adds cases the model
    // genuinely found, never a second row for activity a rule already opened.
    const flaggedResult = await this.raiseModelFlagged({
      vectors,
      traffic,
      handled,
      ruleIncidents,
      scored,
      change,
      hash,
      provenance,
      asOf,
    });
    opened += flaggedResult.opened;
    updated += flaggedResult.updated;

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
   * The learned second opinion, only when it is warranted and within the per-pass cap.
   *
   * Extracted so the decision loop stays legible: the model is advisory, so the conditions under
   * which it does *not* run belong in one place rather than tangled into the arbitration branch.
   */
  /**
   * The model-only pass: raise a review case on each entity the rules opened nothing for that the
   * model is confident enough to call an attack on its own — the distributed and low-and-slow
   * attacks a single-entity burst gate structurally cannot see. Deduplicated against the rule tier's
   * incidents by same-activity, so one machine seen through a coarser key is never a second case.
   */
  private async raiseModelFlagged(ctx: {
    vectors: Map<string, FeatureVector>;
    traffic: TrafficContext;
    handled: Set<string>;
    ruleIncidents: readonly ComputedIncident[];
    scored: number;
    change: ChangeResult | null;
    hash: string;
    provenance: Map<string, EventSource>;
    asOf: number;
  }): Promise<{ opened: number; updated: number }> {
    const { vectors, traffic, handled, ruleIncidents, change, hash, provenance, asOf } = ctx;
    let scored = ctx.scored;
    let opened = 0;
    let updated = 0;

    // Only where the shop as a whole is failing far more than any honest hour does. A healthy or
    // merely busy shop keeps approving shoppers, and there the model does not get to raise a case on
    // its own — the restraint that keeps a legitimate sale from ever being second-guessed.
    if (traffic.approvalRate > MODEL_FLAG_APPROVAL_CEILING) return { opened, updated };

    const flagged = new Map<string, { incident: ComputedIncident; opinion: ModelOpinion }>();
    for (const [entityId, vector] of vectors) {
      if (handled.has(entityId) || scored >= MAX_SCORED_PER_PASS) continue;
      const opinion = this.scoreWhenWarranted(vector, traffic, scored);
      if (opinion !== null) scored += 1;
      if (opinion === null || !modelFlagsMissedEntity(IncidentsService.verdictOf(opinion)))
        continue;
      // No rule fired, so the rule score is an honest zero — but the incident the model raised is not
      // a zero-risk one. Its risk *is* the model's P(abuse), carried as the score so severity, band
      // and the queue read the model's confidence instead of an empty rule sum. The evidence stays
      // empty on purpose: the "why" here is the model, shown as such, not a rule that did not fire.
      const score = IncidentsService.modelRiskScore(opinion.risk);
      flagged.set(entityId, {
        incident: {
          ...openIncident({ outcomes: [], vector, at: asOf }),
          score,
          severity: severityOf(score),
        },
        opinion,
      });
    }

    // The first wave only, so a distributed attack surfaces as an unmistakable cluster rather than one
    // row per address. Ordered by when the entity first appeared, not by risk (which is uniformly high
    // across a card-testing run): the earliest few are a stable set as the run grows, so each pass
    // re-selects and updates them in place instead of accreting a new row every tick.
    const deduped = dropDuplicateViews([...flagged.values()].map((entry) => entry.incident));
    const capped = [...deduped]
      .sort((a, b) => a.firstAttemptAt - b.firstAttemptAt || a.entityKey.localeCompare(b.entityKey))
      .slice(0, MODEL_FLAG_MAX_PER_PASS);
    for (const kept of capped) {
      // One machine is one session, one device and one network. If the rule tier already opened a
      // case on any view of this activity, the model flagging another view of the *same* machine is
      // the same incident seen through a coarser key, not a new one.
      if (ruleIncidents.some((rule) => describesSameActivity(rule, kept))) continue;
      const entityId = `${kept.entityKind}:${kept.entityKey}`;
      const entry = flagged.get(entityId);
      const vector = vectors.get(entityId);
      if (entry === undefined || vector === undefined) continue;
      const source = provenance.get(kept.entityKey) ?? 'razorpay';
      // A replay or a live burst may be evaluated more than once. The rule tier deduplicates
      // the current pass, but a previous pass may already have persisted the same activity under
      // another correlation key. Do not let the model-only pass create a second queue row for it.
      if (await this.hasSameActivity(kept, source)) continue;
      const base = arbitrate(vector, traffic);
      // The model may raise a case the rules missed — but not over a confident benign explanation.
      // A binary risk score cannot tell a busy-but-innocent entity from an attack; the arbitration
      // can, and where it positively identified an outage, dunning or an ordinary hour, that wins.
      if (arbitrationExplainsBenign(base.best)) continue;
      const decided: StoredArbitration = {
        ...base,
        decision: 'review',
        reasons: [...base.reasons, 'model_flagged_attack_no_rule'],
        modelInfluence: 'flagged',
      };
      const wrote = await this.upsert(
        kept,
        change,
        hash,
        source,
        decided,
        entry.opinion,
        IncidentsService.featuresObject(vector, traffic),
        countsOf(vector),
      );
      if (wrote === 'opened') opened += 1;
      else updated += 1;
    }

    return { opened, updated };
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
   */
  private async entityGraph(
    entityKind: 'session' | 'device' | 'network',
    entityKey: string,
    source: 'razorpay' | 'replay',
    from: Date,
    to: Date,
  ): Promise<IncidentGraph> {
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
          eq(column, entityKey),
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
