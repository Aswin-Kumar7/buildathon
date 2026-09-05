import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  canonicalEvents,
  checkoutSessions,
  inboxEvents,
  incidents,
  type DbHandle,
} from '@sentinel/db';
import { SCENARIO_FAMILIES, type GeneratedScenario, type ScenarioFamily } from '@sentinel/corpus';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { seal, toKey } from '../telemetry/envelope.js';
import { pseudonymise, pseudonymiseIp } from '../telemetry/pseudonym.js';
import { toEventTime, webhookEnvelopeSchema } from '../webhooks/redact.js';
import { DrainService } from '../webhooks/drain.service.js';
import { IncidentsService } from '../incidents/incidents.service.js';
import type { EvaluateResponse } from '@sentinel/contracts';

/**
 * Whether replay may run at all.
 *
 * A free function rather than a method so it can be tested for what it is — a rule — without
 * booting an application. Booting one under NODE_ENV=production is not even possible without
 * a real database, because the environment schema refuses to start without one, so a test
 * that went that route would be testing the wrong guard.
 *
 * The default stays closed. A merchant's deployment must not be able to accept invented traffic
 * whatever anyone types into a console, because its own figures would stop meaning anything
 * afterwards. The hosted demo is the one place that reasoning does not apply — nothing cites its
 * database, and every published number comes from CI running the corpus in a separate process —
 * so it opts in by name, rather than the rule quietly being dropped for everybody.
 */
export function assertReplayAllowed(nodeEnv: string, allowInProduction = false): void {
  if (nodeEnv === 'production' && !allowInProduction) {
    throw new ForbiddenException(
      'Replay is disabled in production. Synthetic events must never enter a deployment whose numbers are cited as evidence. A demo instance can opt in with ALLOW_REPLAY_IN_PRODUCTION.',
    );
  }
}

export interface ReplayResult {
  family: ScenarioFamily;
  checkoutsWritten: number;
  eventsWritten: number;
  duplicatesSkipped: number;
  detection: EvaluateResponse;
}

/** The event's own timestamp in seconds, preferring the payment entity's over the envelope's. */
function eventCreatedSeconds(body: unknown): number | null {
  const shape = body as {
    created_at?: unknown;
    payload?: { payment?: { entity?: { created_at?: unknown } } };
  };
  const entity = shape.payload?.payment?.entity?.created_at;
  if (typeof entity === 'number') return entity;
  if (typeof shape.created_at === 'number') return shape.created_at;
  return null;
}

/**
 * A copy of the webhook body with every `created_at` moved forward by `offsetSeconds`.
 *
 * The canonical event time the console reads is re-derived by the drain from the *body*, not the
 * inbox row, so shifting the body is the only place a re-base actually lands.
 */
function shiftEventTime(body: unknown, offsetSeconds: number): unknown {
  const clone = structuredClone(body) as {
    created_at?: number;
    payload?: { payment?: { entity?: { created_at?: number } } };
  };
  if (typeof clone.created_at === 'number') clone.created_at += offsetSeconds;
  const entity = clone.payload?.payment?.entity;
  if (entity !== undefined && typeof entity.created_at === 'number') {
    entity.created_at += offsetSeconds;
  }
  return clone;
}

/**
 * Replays a committed scenario into the inbox.
 *
 * Local only, and it writes into the database directly. There is deliberately **no
 * configurable HTTP target**: a replay tool that can be pointed at a hostname is a load
 * generator, and one shipped in a payments repository is a load generator aimed at somebody
 * else's checkout. The absence of that option is a security decision, not an omission.
 *
 * Everything downstream of the insert is the real path — the same encryption, the same drain,
 * the same redaction, the same state resolution. A harness that took a shortcut past any of
 * that would be testing the shortcut.
 */
@Injectable()
export class ReplayService {
  private readonly env = loadEnv();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly drain: DrainService,
    private readonly incidents: IncidentsService,
  ) {}

  private get pseudonymConfig() {
    return { key: this.env.PSEUDONYM_KEY_V1, version: this.env.PSEUDONYM_KEY_VERSION };
  }

  async load(family: ScenarioFamily): Promise<GeneratedScenario> {
    if (!SCENARIO_FAMILIES.includes(family)) throw new NotFoundException(`No scenario ${family}`);

    // Read from the committed fixture rather than regenerated on the fly. The fixture is what
    // was pre-registered; regenerating would quietly follow any later change to the spec.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const path = join(root, 'fixtures', 'scenarios', `${family}.json`);

    try {
      return JSON.parse(await readFile(path, 'utf8')) as GeneratedScenario;
    } catch {
      throw new NotFoundException(
        `Scenario ${family} is not in fixtures/scenarios. Run 'pnpm --filter @sentinel/corpus corpus:generate'.`,
      );
    }
  }

  /**
   * @param rebase When true, shift the scenario so its latest moment is ~now — recent-looking
   * traffic for a demo. When false (the default), the recorded timestamps are preserved, which is
   * the historical case the feature-freshness and window-anchoring behaviour is defined against.
   */
  async replay(family: ScenarioFamily, rebase = false): Promise<ReplayResult> {
    assertReplayAllowed(this.env.NODE_ENV, this.env.ALLOW_REPLAY_IN_PRODUCTION);

    const scenario = await this.load(family);
    const key = this.env.PAYLOAD_KEY_V1;
    if (key === undefined || key === '') {
      throw new ForbiddenException('PAYLOAD_KEY_V1 is not configured, so nothing can be stored.');
    }

    const masterKey = toKey(key);
    let checkoutsWritten = 0;
    let eventsWritten = 0;
    let duplicatesSkipped = 0;

    // Shift the whole scenario so its latest moment is ~now. Every timestamp moves by the same
    // offset, so relative timing — and therefore the detection result — is unchanged, but the
    // replayed activity reads as recent traffic instead of a fixed historical date. That is what
    // lets the time-series ("risk over the last day/week/month") and the "today" counters actually
    // show a scenario replayed for a demo, rather than one dated months in the past.
    const eventSeconds = scenario.events
      .map((event) => eventCreatedSeconds(event.body))
      .filter((seconds): seconds is number => seconds !== null);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const latestSeconds = eventSeconds.length === 0 ? 0 : Math.max(...eventSeconds);
    const offsetSeconds = rebase && latestSeconds !== 0 ? nowSeconds - latestSeconds : 0;
    const offsetMs = offsetSeconds * 1000;

    // The sensor half. Pseudonymised through exactly the same functions the storefront uses,
    // so a replayed session correlates the way a real one would — which is the only reason the
    // distributed attack is detectable at all.
    for (const checkout of scenario.checkouts) {
      const inserted = await this.handle.db
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
          createdAt: new Date(new Date(checkout.createdAt).getTime() + offsetMs),
          source: 'replay',
          family,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) checkoutsWritten += 1;
    }

    for (const event of scenario.events) {
      const body = shiftEventTime(event.body, offsetSeconds);
      const raw = JSON.stringify(body);
      const envelope = webhookEnvelopeSchema.parse(body);
      const sealed = seal(raw, masterKey, this.env.PAYLOAD_KEY_VERSION);
      const eventAt = toEventTime(eventCreatedSeconds(body), new Date());

      const inserted = await this.handle.db
        .insert(inboxEvents)
        .values({
          razorpayEventId: event.razorpayEventId,
          eventType: envelope.event,
          source: 'replay',
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          authTag: sealed.authTag,
          wrappedKey: sealed.wrappedKey,
          wrappedKeyIv: sealed.wrappedKeyIv,
          wrappedKeyTag: sealed.wrappedKeyTag,
          keyVersion: sealed.keyVersion,
          eventAt,
          receivedAt: sql`now()`,
          late: false,
          family,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) eventsWritten += 1;
      else duplicatesSkipped += 1;
    }

    // A replay is not complete when rows merely exist in the inbox. Process only this
    // synthetic source immediately, then evaluate it, so the button has a truthful
    // end-to-end result and the Incidents page is populated before the response returns.
    // Drain the complete replay, not just one worker batch. Evaluating a partial burst would
    // create an incident for the prefix and a second incident when the remaining events arrive.
    for (;;) {
      const report = await this.drain.drainOnce('replay');
      if (report.claimed === 0) break;
    }
    const detection = await this.incidents.evaluate('replay');
    await this.tagReplayFamily(family);

    return { family, checkoutsWritten, eventsWritten, duplicatesSkipped, detection };
  }

  /**
   * Removes everything a replay wrote, and nothing else.
   *
   * Scoped by `source`, so a demo run cannot take real events with it. Without this, the only
   * way to clear a scenario would be to guess at identifier prefixes.
   */
  async clear(): Promise<{ removed: number }> {
    assertReplayAllowed(this.env.NODE_ENV, this.env.ALLOW_REPLAY_IN_PRODUCTION);

    const removedIncidents = await this.handle.db
      .delete(incidents)
      .where(eq(incidents.source, 'replay'))
      .returning();

    const events = await this.handle.db
      .delete(inboxEvents)
      .where(eq(inboxEvents.source, 'replay'))
      .returning();

    await this.handle.db.delete(checkoutSessions).where(eq(checkoutSessions.source, 'replay'));

    return { removed: events.length + removedIncidents.length };
  }

  /** Tags this pass's freshly-opened replay incidents with their scenario, so a re-run resets only them. */
  private async tagReplayFamily(family: string): Promise<void> {
    await this.handle.db
      .update(incidents)
      .set({ family })
      .where(and(eq(incidents.source, 'replay'), isNull(incidents.family)));
  }

  /**
   * Removes one scenario's replayed rows, and nothing else — so re-running a scenario replaces its
   * own incidents while the other scenarios stay. Scoped by source AND family.
   */
  async clearFamily(family: string): Promise<{ removed: number }> {
    assertReplayAllowed(this.env.NODE_ENV, this.env.ALLOW_REPLAY_IN_PRODUCTION);

    const removedIncidents = await this.handle.db
      .delete(incidents)
      .where(and(eq(incidents.source, 'replay'), eq(incidents.family, family)))
      .returning();

    const events = await this.handle.db
      .delete(inboxEvents)
      .where(and(eq(inboxEvents.source, 'replay'), eq(inboxEvents.family, family)))
      .returning();

    await this.handle.db
      .delete(checkoutSessions)
      .where(and(eq(checkoutSessions.source, 'replay'), eq(checkoutSessions.family, family)));

    return { removed: events.length + removedIncidents.length };
  }

  /**
   * Wipes all detection data — incidents, canonical events, inbox events and checkout sessions,
   * across every source — so a demo can start from a clean slate. Deleting incidents cascades to
   * their transitions and containments. The audit trail, policies and users are left intact, and
   * the storefront's own product catalogue is a separate concern this never touches.
   *
   * Dev-only, by the same rule replay is: never destroy data in a deployment whose numbers are
   * cited as evidence.
   */
  async resetAll(): Promise<{ removed: number }> {
    assertReplayAllowed(this.env.NODE_ENV, this.env.ALLOW_REPLAY_IN_PRODUCTION);

    const removedIncidents = await this.handle.db.delete(incidents).returning();
    const removedCanonical = await this.handle.db.delete(canonicalEvents).returning();
    const removedInbox = await this.handle.db.delete(inboxEvents).returning();
    const removedCheckouts = await this.handle.db.delete(checkoutSessions).returning();

    return {
      removed:
        removedIncidents.length +
        removedCanonical.length +
        removedInbox.length +
        removedCheckouts.length,
    };
  }

  /** Counts by source, so the console can say what is real and what is not. */
  async counts(): Promise<{ razorpay: number; replay: number }> {
    const [row] = await this.handle.db
      .select({
        razorpay: sql<number>`count(*) filter (where ${canonicalEvents.source} = 'razorpay')::int`,
        replay: sql<number>`count(*) filter (where ${canonicalEvents.source} = 'replay')::int`,
      })
      .from(canonicalEvents);

    return { razorpay: Number(row?.razorpay ?? 0), replay: Number(row?.replay ?? 0) };
  }
}
