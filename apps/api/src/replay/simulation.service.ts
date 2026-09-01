import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  canonicalEvents,
  checkoutSessions,
  incidents,
  inboxEvents,
  simulationRuns,
  type DbHandle,
} from '@sentinel/db';
import {
  generate,
  SCENARIOS,
  type GeneratedScenario,
  type ScenarioFamily,
  type ScenarioOverrides,
} from '@sentinel/corpus';
import type {
  SimulationActivity,
  SimulationDetected,
  SimulationPhase,
  SimulationRun,
  SimulationScenario,
  SimulationStatus,
  SimulationStoodDown,
} from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { seal, toKey } from '../telemetry/envelope.js';
import { pseudonymise, pseudonymiseIp } from '../telemetry/pseudonym.js';
import { webhookEnvelopeSchema } from '../webhooks/redact.js';
import { DrainService } from '../webhooks/drain.service.js';
import { IncidentsService } from '../incidents/incidents.service.js';
import { assertReplayAllowed } from './replay.service.js';

/** A brisk arrival every ~0.3s, lightly jittered so it is not a metronome. */
const MIN_INTERVAL_MS = 200;
const MAX_INTERVAL_MS = 380;
/** The run stops itself after this long — the whole campaign lands inside two minutes. */
const MAX_DURATION_MS = 118_000;
/** Cap on transactions per run: a busy couple of minutes at a real merchant, not a trickle. */
const CAP = 250;
/** How often the parallel processing loop drains the inbox backlog and re-runs the detector. */
const PROCESS_INTERVAL_MS = 4_000;

/**
 * The per-run seed base, and the stride between runs.
 *
 * Event and order ids are a pure function of the scenario seed, and the inbox's unique constraint on
 * the event id silently discards a re-generated id (`onConflictDoNothing`). So a run's seed must
 * never repeat for the life of the database, or the run inserts nothing while still reporting traffic
 * generated. The ordinal that drives this is the size of the append-only `simulation_runs` log —
 * monotonic across restarts — not an in-memory counter that resets to zero on every boot. `ORIGIN` is
 * far from both the corpus fixtures' seeds (~1e3) and the old `5000 + k*100` scheme's rows, so a new
 * run collides with neither; `STRIDE` exceeds the largest per-scenario `index * 7` offset a campaign
 * uses, so two runs' seed blocks never overlap.
 */
const SEED_ORIGIN = 1_000_003;
const SEED_STRIDE = 131;

/** The statuses that still count as an open detection — resolved/expired ones were stood down. */
const ACTIVE_INCIDENT_STATUSES = new Set(['open', 'under_review', 'contained']);

/** The benign explanations a de-escalation resolves an incident to — the judgment worth showing. */
const BENIGN_HYPOTHESES = new Set(['retry_storm', 'outage', 'healthy_traffic']);

/**
 * The campaign. A real merchant's afternoon: the overwhelming majority is ordinary UPI-heavy traffic
 * that mostly succeeds, a gateway wobble and a subscription biller's dunning add operational noise the
 * detector must *not* flag, and several card-testing attacks of different shapes and severities run
 * through it. The weights are a traffic mix, not detector tuning; what each becomes — its title,
 * severity and whether it opens at all — is computed live by the same detector, every run.
 */
const MIX: { family: ScenarioFamily; weight: number; overrides?: ScenarioOverrides }[] = [
  // The bulk of the stream: real shoppers paying, mostly first-time, across every rail. Ordinary
  // traffic is a smaller pool than a flash sale, so the sale carries the benign majority through the
  // later part of the run once ordinary orders are spent — the page stays mostly legitimate throughout.
  { family: 'normal_traffic', weight: 10 },
  { family: 'flash_sale', weight: 7 },
  // Attacks of different shapes, so the incident feed shows the detector's range rather than one card:
  { family: 'attack_loud', weight: 2 }, // one machine, tiny amounts → Coordinated card testing, high
  { family: 'attack_carding', weight: 1 }, // stolen cards at real prices → Coordinated card testing, high (no small-amount tell)
  { family: 'attack_proxy', weight: 2 }, // many sessions behind one network → Distributed card testing, high
  { family: 'attack_partial', weight: 1 }, // a part-valid list → Coordinated card testing, medium, sent to review
  // Operational noise the detector must NOT act on — the restraint that separates it from a blunt
  // failure counter. A gateway wobble hits everyone at once; a biller retries a few cards on a timer.
  // A dunning burst can briefly look like testing and open, then stand down once the reuse shows —
  // the run surfaces those separately, as judgment rather than as detections.
  { family: 'gateway_outage', weight: 2 },
  { family: 'retry_storm', weight: 1 },
];

interface PendingEvent {
  body: unknown;
  razorpayEventId: string;
}

/** The webhooks of one order, kept together so they stream as a single transaction. */
interface Transaction {
  orderId: string;
  events: PendingEvent[];
  /**
   * Distinct payment attempts on this order. Usually 1, but a declined order retried three times is
   * one transaction carrying three payments — which is why the run counts payments, not transactions:
   * otherwise "payments generated" would undercount and read as less than "attempts correlated".
   */
  paymentCount: number;
}

type WebhookBody = {
  created_at?: number;
  payload?: {
    payment?: { entity?: { id?: string; created_at?: number; order_id?: string } };
    order?: { entity?: { created_at?: number; id?: string } };
  };
};

/** When the webhook says the event happened, in epoch seconds. */
function eventCreatedSeconds(body: unknown): number {
  const parsed = body as WebhookBody;
  return parsed.payload?.payment?.entity?.created_at ?? parsed.created_at ?? 0;
}

/** The order a webhook belongs to — the key that makes several events one transaction. */
function orderIdOf(body: unknown): string | null {
  const parsed = body as WebhookBody;
  return parsed.payload?.payment?.entity?.order_id ?? parsed.payload?.order?.entity?.id ?? null;
}

/** The payment a webhook is about, when it carries one. Order-only events (e.g. order.paid) have none. */
function paymentIdOf(body: unknown): string | null {
  const parsed = body as WebhookBody;
  return parsed.payload?.payment?.entity?.id ?? null;
}

/** Re-date a webhook to a given second, so the drain reads it as arriving then. */
function stampAt(body: unknown, seconds: number): unknown {
  const clone = structuredClone(body) as WebhookBody;
  clone.created_at = seconds;
  const paymentEntity = clone.payload?.payment?.entity;
  if (paymentEntity !== undefined) paymentEntity.created_at = seconds;
  const orderEntity = clone.payload?.order?.entity;
  if (orderEntity !== undefined) orderEntity.created_at = seconds;
  return clone;
}

/** Groups a scenario's raw events into transactions, preserving first-seen order. */
function buildTransactions(scenario: GeneratedScenario): Transaction[] {
  const byOrder = new Map<string, Transaction>();
  const payments = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const event of scenario.events) {
    const orderId = orderIdOf(event.body) ?? event.razorpayEventId;
    let transaction = byOrder.get(orderId);
    if (transaction === undefined) {
      transaction = { orderId, events: [], paymentCount: 0 };
      byOrder.set(orderId, transaction);
      payments.set(orderId, new Set());
      order.push(orderId);
    }
    transaction.events.push({ body: event.body, razorpayEventId: event.razorpayEventId });
    const paymentId = paymentIdOf(event.body);
    if (paymentId !== null) payments.get(orderId)!.add(paymentId);
  }
  for (const [orderId, transaction] of byOrder) {
    transaction.paymentCount = payments.get(orderId)!.size;
  }
  return order.map((orderId) => byOrder.get(orderId)!);
}

/**
 * Streams a mixed campaign of synthetic transactions through the real ingestion pipeline, one every
 * few seconds, so a demo watches incidents form live instead of appearing all at once.
 *
 * Every transaction takes the production path — sealed into the inbox, drained, redacted to
 * canonical, then scored by the same detector live traffic is. Nothing about the outcome is
 * fabricated: which transactions become an incident, and what it is called, is computed each run.
 * Dev-only, by the same rule replay is.
 */
@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);
  private readonly env = loadEnv();

  // Two independent loops: a fast one that only seals transactions into the inbox, and a slower one
  // that drains that backlog and scores it. Ingestion is not throttled by the cost of evaluation, so
  // a full couple-hundred-transaction campaign fits inside two minutes.
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private processTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private emitting = false;
  private queue: Transaction[] = [];
  private emitted = 0;
  private total = 0;
  private startedAt = 0;
  /** The chosen scenario for this run, or null for the full mixed campaign. */
  private family: ScenarioFamily | null = null;
  /** How many detection passes the process loop has run this run — a real signal, not a timer. */
  private evaluations = 0;
  /** The durable history row for the current run, updated as it progresses and finalised on stop. */
  private currentRunId: string | null = null;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly drain: DrainService,
    private readonly incidents: IncidentsService,
  ) {}

  private get pseudonymConfig() {
    return { key: this.env.PSEUDONYM_KEY_V1, version: this.env.PSEUDONYM_KEY_VERSION };
  }

  get running(): boolean {
    return this.active;
  }

  /**
   * The live run state, computed from real backend state every poll — never a timer or a counter the
   * frontend advances. Payments generated is what was streamed; attempts correlated and incidents
   * detected are queried from the database for this run; the phase is derived from those real signals.
   */
  async status(): Promise<SimulationStatus> {
    const startDate = this.startedAt === 0 ? null : new Date(this.startedAt);

    const detected = startDate === null ? [] : await this.detectedIncidents(startDate);
    const stoodDown = startDate === null ? [] : await this.stoodDownIncidents(startDate);
    const attemptsCorrelated = startDate === null ? 0 : await this.countCorrelated(startDate);
    const recent = startDate === null ? [] : await this.recentPayments(startDate);

    const incidentsDetected = detected.length;
    const phase: SimulationPhase =
      incidentsDetected > 0
        ? 'incident'
        : this.active && this.emitted < this.total
          ? 'generating'
          : this.emitted > 0
            ? 'analyzing'
            : 'idle';

    const activity: SimulationActivity[] = recent.map((row) => ({
      at: row.eventAt.getTime(),
      kind: 'payment',
      paymentId: row.paymentId,
      status: row.status,
      amountPaise: row.amountPaise,
      method: row.method,
      title: null,
      severity: null,
      incidentId: null,
    }));
    for (const incident of detected.slice(0, 3)) {
      activity.push({
        at: incident.at,
        kind: 'incident',
        paymentId: null,
        status: null,
        amountPaise: null,
        method: null,
        title: incident.title,
        severity: incident.severity,
        incidentId: incident.id,
      });
    }
    activity.sort((a, b) => b.at - a.at);

    return {
      running: this.active,
      phase,
      emitted: this.emitted,
      total: this.total,
      attemptsCorrelated,
      incidentsDetected,
      evaluations: this.evaluations,
      startedAt: startDate === null ? null : startDate.toISOString(),
      scenario: this.scenarioMeta(),
      recentActivity: activity.slice(0, 8),
      detected: detected.map((incident) => ({
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        score: incident.score,
        status: incident.status,
        entityKind: incident.entityKind,
      })),
      stoodDown,
    };
  }

  /**
   * Incidents this run opened on a burst and then stood down — re-explained as legitimate activity
   * and resolved without acting. This is the de-escalation on show: a dunning storm's first minutes
   * look like card testing, so an incident opens; once the reuse becomes visible the detector
   * re-classifies it as a retry storm and resolves it. Shown apart from detections so the retracted
   * open is never counted as one.
   */
  private async stoodDownIncidents(since: Date): Promise<SimulationStoodDown[]> {
    const { incidents } = await this.incidents.list(undefined, 'replay');
    return incidents
      .filter((incident) => incident.detectedAt >= since.getTime())
      .filter(
        (incident) =>
          incident.status === 'resolved' && BENIGN_HYPOTHESES.has(incident.primaryHypothesis),
      )
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .map((incident) => ({
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        entityKind: incident.entityKind,
        resolvedAs: incident.primaryHypothesis.replace(/_/g, ' '),
      }));
  }

  /** The catalogue metadata for the running scenario, or null for the mixed campaign. */
  private scenarioMeta(): SimulationScenario | null {
    if (this.family === null) return null;
    const spec = SCENARIOS[this.family];
    return {
      family: this.family,
      title: spec.title,
      description: spec.narrative,
      classification: spec.classification,
    };
  }

  /**
   * The incidents this run produced, via {@link IncidentsService.list} so the derived title/severity
   * are exactly what the Incidents page shows — the same source of truth, never a second derivation.
   */
  private async detectedIncidents(since: Date): Promise<(SimulationDetected & { at: number })[]> {
    const { incidents } = await this.incidents.list(undefined, 'replay');
    return (
      incidents
        .filter((incident) => incident.detectedAt >= since.getTime())
        // Only what Sentinel currently holds as an incident. One it opened on a burst and then
        // stood down (re-explained as dunning or an outage) is no longer a detection — showing it
        // here would report a false positive the detector already retracted.
        .filter((incident) => ACTIVE_INCIDENT_STATUSES.has(incident.status))
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .map((incident) => ({
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          score: incident.score,
          status: incident.status,
          entityKind: incident.entityKind,
          at: incident.detectedAt,
        }))
    );
  }

  private async countCorrelated(since: Date): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: sql<number>`count(distinct ${canonicalEvents.razorpayPaymentId})::int` })
      .from(canonicalEvents)
      .where(and(eq(canonicalEvents.source, 'replay'), gte(canonicalEvents.createdAt, since)));
    return Number(row?.n ?? 0);
  }

  private async recentPayments(since: Date): Promise<
    {
      paymentId: string | null;
      status: string | null;
      amountPaise: number | null;
      method: string | null;
      eventAt: Date;
    }[]
  > {
    return this.handle.db
      .select({
        paymentId: canonicalEvents.razorpayPaymentId,
        status: canonicalEvents.status,
        amountPaise: canonicalEvents.amountPaise,
        method: canonicalEvents.method,
        eventAt: canonicalEvents.eventAt,
      })
      .from(canonicalEvents)
      .where(and(eq(canonicalEvents.source, 'replay'), gte(canonicalEvents.createdAt, since)))
      .orderBy(desc(canonicalEvents.eventAt))
      .limit(8);
  }

  async start(family?: ScenarioFamily): Promise<{ running: boolean; total: number }> {
    assertReplayAllowed(this.env.NODE_ENV);
    if (this.active) return { running: true, total: this.total };
    // A chosen scenario streams just that behaviour; without one, the full mixed campaign runs. Either
    // way the transactions take the real pipeline — the detector decides what, if anything, they become.
    this.family = family ?? null;
    this.evaluations = 0;
    await this.buildQueue();
    this.startedAt = Date.now();
    await this.recordRunStart();
    this.active = true;
    this.emitting = true;
    this.scheduleEmit();
    this.scheduleProcess();
    return { running: true, total: this.total };
  }

  /**
   * The next run's seed ordinal: the number of runs already recorded. The `simulation_runs` log is
   * append-only and untouched by any reset, so this only ever climbs — including across a restart,
   * which is the whole point (an in-memory counter reset to zero and made the first run after a boot
   * reuse an earlier boot's seed, regenerating ids the inbox then silently dropped).
   */
  private async runOrdinal(): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(simulationRuns);
    return Number(row?.n ?? 0);
  }

  /** Builds the planned run — generates the mix, writes its sensor context, and queues transactions. */
  private async buildQueue(): Promise<void> {
    // A seed that never repeats for the life of the database (see SEED_ORIGIN), and realistic rails so
    // the stream looks like an actual merchant's, not a wall of test cards.
    const ordinal = await this.runOrdinal();
    const plan: { family: ScenarioFamily; weight: number; overrides?: ScenarioOverrides }[] =
      this.family !== null ? [{ family: this.family, weight: 1 }] : MIX;
    const scenarios = plan.map((entry, index) => {
      const scenario = generate(entry.family, SEED_ORIGIN + ordinal * SEED_STRIDE + index * 7, {
        realisticMethods: true,
        ...entry.overrides,
      });
      return { weight: entry.weight, scenario, transactions: buildTransactions(scenario) };
    });

    this.queue = SimulationService.interleave(scenarios);
    const streamed = new Set(this.queue.map((transaction) => transaction.orderId));
    await this.writeCheckouts(scenarios, streamed);
    // Counted in payment attempts, not transactions, so it lines up with `attemptsCorrelated`
    // (distinct payments drained) — a declined-and-retried order is several payments, one transaction.
    this.total = this.queue.reduce((sum, transaction) => sum + transaction.paymentCount, 0);
    this.emitted = 0;
  }

  /** Drains the whole inbox backlog in batches, turning sealed transactions into canonical events. */
  private async drainBacklog(): Promise<void> {
    for (;;) {
      const report = await this.drain.drainOnce('replay');
      if (report.claimed === 0) break;
    }
  }

  /**
   * Streams the whole planned run at once, without the inter-transaction timers, and evaluates.
   *
   * The timed {@link start} is the demo; this is the same ingestion collapsed to no-wait, for tests
   * and a fast-forward that needs the end state (which incidents formed, and what they are called)
   * without waiting out three minutes of real time.
   */
  async streamAll(): Promise<{ emitted: number }> {
    assertReplayAllowed(this.env.NODE_ENV);
    await this.buildQueue();
    const transactions = [...this.queue];
    this.queue = [];
    // Spread the anchors across a recent 25-minute window (inside the feature window) so the run has
    // the timing spread a live one gets from its 3–5s pacing, rather than every transaction landing
    // on one second.
    const spanSeconds = 25 * 60;
    const now = Math.floor(Date.now() / 1000);
    for (let index = 0; index < transactions.length; index += 1) {
      const anchor = now - spanSeconds + Math.floor((index / transactions.length) * spanSeconds);
      const inserted = await this.emit(transactions[index]!, anchor);
      if (inserted > 0) this.emitted += transactions[index]!.paymentCount;
    }
    await this.drainBacklog();
    await this.incidents.evaluate('replay');
    await this.tagOpenedIncidents();
    return { emitted: this.emitted };
  }

  async stop(): Promise<{ running: boolean }> {
    this.active = false;
    this.emitting = false;
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.processTimer !== null) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    await this.snapshotRun(true);
    return { running: false };
  }

  /** Opens the durable history row for a run. Its `detected` is filled in as the run progresses. */
  private async recordRunStart(): Promise<void> {
    const meta = this.scenarioMeta();
    const [row] = await this.handle.db
      .insert(simulationRuns)
      .values({
        family: this.family ?? 'mixed',
        scenarioTitle: meta?.title ?? 'Mixed campaign',
        classification: meta?.classification ?? 'mixed',
        status: 'running',
        detected: [],
        startedAt: new Date(this.startedAt),
      })
      .returning();
    this.currentRunId = row?.id ?? null;
  }

  /**
   * Writes the run's real counts and a SNAPSHOT of what it detected into its history row. The snapshot
   * is a copy (title/severity/score), so the record survives when the next run resets the incidents.
   */
  private async snapshotRun(finished: boolean): Promise<void> {
    if (this.currentRunId === null) return;
    const since = new Date(this.startedAt);
    const detected = await this.detectedIncidents(since);
    const attemptsCorrelated = await this.countCorrelated(since);
    await this.handle.db
      .update(simulationRuns)
      .set({
        paymentsGenerated: this.emitted,
        attemptsCorrelated,
        incidentsDetected: detected.length,
        detected: detected.map((incident) => ({
          title: incident.title,
          severity: incident.severity,
          score: incident.score,
          entityKind: incident.entityKind,
        })),
        status: finished ? 'finished' : 'running',
        ...(finished ? { endedAt: new Date() } : {}),
      })
      .where(eq(simulationRuns.id, this.currentRunId));
    if (finished) this.currentRunId = null;
  }

  /** The durable run history, most recent first — kept apart from the transient incident queue. */
  async listRuns(limit = 20): Promise<SimulationRun[]> {
    const rows = await this.handle.db
      .select()
      .from(simulationRuns)
      .orderBy(desc(simulationRuns.startedAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      family: row.family,
      scenarioTitle: row.scenarioTitle,
      classification: row.classification,
      status: row.status,
      paymentsGenerated: row.paymentsGenerated,
      attemptsCorrelated: row.attemptsCorrelated,
      incidentsDetected: row.incidentsDetected,
      detected: (row.detected as SimulationRun['detected']) ?? [],
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
  }

  private scheduleEmit(): void {
    const jitter = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
    this.emitTimer = setTimeout(() => void this.emitTick(), jitter);
  }

  private scheduleProcess(): void {
    this.processTimer = setTimeout(() => void this.processTick(), PROCESS_INTERVAL_MS);
  }

  /** Round-robins whole transactions across families by weight, up to the cap. */
  private static interleave(
    scenarios: { weight: number; transactions: Transaction[] }[],
  ): Transaction[] {
    const queues = scenarios.map((entry) => ({
      weight: entry.weight,
      transactions: [...entry.transactions],
    }));
    const out: Transaction[] = [];
    while (out.length < CAP && queues.some((queue) => queue.transactions.length > 0)) {
      for (const queue of queues) {
        for (
          let i = 0;
          i < queue.weight && queue.transactions.length > 0 && out.length < CAP;
          i += 1
        ) {
          out.push(queue.transactions.shift()!);
        }
      }
    }
    return out;
  }

  /**
   * Writes the sensor context — session, device and network pseudonyms — for the checkouts that
   * actually stream. This is the only place the correlation keys come from; a Razorpay webhook
   * carries none of them, so without this the detector would have nothing to key an incident on.
   */
  private async writeCheckouts(
    scenarios: { scenario: GeneratedScenario }[],
    streamed: Set<string>,
  ): Promise<void> {
    const now = new Date();
    for (const { scenario } of scenarios) {
      for (const checkout of scenario.checkouts) {
        if (!streamed.has(checkout.razorpayOrderId)) continue;
        await this.handle.db
          .insert(checkoutSessions)
          .values({
            razorpayOrderId: checkout.razorpayOrderId,
            ipPseudonym: pseudonymiseIp(checkout.ip, this.pseudonymConfig),
            devicePseudonym: pseudonymise(
              `${checkout.userAgentFamily}|${checkout.deviceId}`,
              this.pseudonymConfig,
            ),
            sessionPseudonym: pseudonymise(checkout.clientSessionId, this.pseudonymConfig),
            userAgentFamily: checkout.userAgentFamily,
            amountPaise: checkout.amountPaise,
            itemCount: checkout.itemCount,
            createdAt: now,
            source: 'replay',
            family: this.family ?? 'mixed',
          })
          .onConflictDoNothing();
      }
    }
  }

  /** Tags this run's freshly-opened replay incidents with its scenario, so a re-run resets only them. */
  private async tagOpenedIncidents(): Promise<void> {
    await this.handle.db
      .update(incidents)
      .set({ family: this.family ?? 'mixed' })
      .where(and(eq(incidents.source, 'replay'), isNull(incidents.family)));
  }

  /** The fast loop: seal one transaction into the inbox and schedule the next. No scoring here. */
  private async emitTick(): Promise<void> {
    if (!this.active) return;
    if (this.queue.length === 0 || Date.now() - this.startedAt > MAX_DURATION_MS) {
      // Nothing more to feed; the process loop drains what is left and ends the run.
      this.emitting = false;
      return;
    }
    const next = this.queue.shift();
    if (next !== undefined) {
      try {
        // Count what actually landed, not what was planned: a transaction whose ids already exist is
        // discarded by the inbox's unique constraint, and reporting it as generated is how a run that
        // ingested nothing still claimed a full campaign and looked like a detector that missed.
        const inserted = await this.emit(next);
        if (inserted > 0) this.emitted += next.paymentCount;
      } catch (error) {
        this.logger.error(error);
      }
    }
    this.scheduleEmit();
  }

  /** The parallel loop: drain the backlog to canonical and score it, then either continue or finish. */
  private async processTick(): Promise<void> {
    if (!this.active) return;
    try {
      await this.drainBacklog();
      await this.incidents.evaluate('replay');
      await this.tagOpenedIncidents();
      this.evaluations += 1;
      await this.snapshotRun(false);
    } catch (error) {
      this.logger.error(error);
    }
    // Ends only once the emit loop has stopped feeding and its final backlog has been drained above.
    if (!this.emitting) {
      await this.stop();
      return;
    }
    this.scheduleProcess();
  }

  /** Seals a transaction into the inbox and returns how many rows were actually written (0 on a full
   * duplicate, where the unique event-id constraint discards every row). */
  private async emit(
    transaction: Transaction,
    anchorSeconds = Math.floor(Date.now() / 1000),
  ): Promise<number> {
    const key = this.env.PAYLOAD_KEY_V1;
    if (key === undefined || key === '') return 0;

    // Anchor the whole transaction at a moment, but keep the seconds between its own events — an
    // authorisation and its capture are moments apart, and flattening them would erase the cadence
    // the detector reads. The timed run anchors at "now"; the fast-forward spreads anchors across a
    // recent window so transactions do not all collide on one second.
    const masterKey = toKey(key);
    const base = Math.min(...transaction.events.map((event) => eventCreatedSeconds(event.body)));

    // A transaction's events go in as one multi-row insert — a single round-trip instead of three,
    // which is what keeps a couple-hundred-transaction run inside its time budget.
    const rows = transaction.events.map((pending) => {
      const stampedSeconds = anchorSeconds + (eventCreatedSeconds(pending.body) - base);
      const body = stampAt(pending.body, stampedSeconds);
      const raw = JSON.stringify(body);
      const envelope = webhookEnvelopeSchema.parse(body);
      const sealed = seal(raw, masterKey, this.env.PAYLOAD_KEY_VERSION);
      return {
        razorpayEventId: pending.razorpayEventId,
        eventType: envelope.event,
        source: 'replay' as const,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        wrappedKey: sealed.wrappedKey,
        wrappedKeyIv: sealed.wrappedKeyIv,
        wrappedKeyTag: sealed.wrappedKeyTag,
        keyVersion: sealed.keyVersion,
        eventAt: new Date(stampedSeconds * 1000),
        receivedAt: sql`now()`,
        late: false,
        family: this.family ?? 'mixed',
      };
    });

    if (rows.length === 0) return 0;
    const inserted = await this.handle.db
      .insert(inboxEvents)
      .values(rows)
      .onConflictDoNothing()
      .returning();
    return inserted.length;
  }
}
