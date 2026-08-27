import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
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
 */
export function assertReplayAllowed(nodeEnv: string): void {
  if (nodeEnv === 'production') {
    throw new ForbiddenException(
      'Replay is disabled in production. Synthetic events must never enter a deployment whose numbers are cited as evidence.',
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

  async replay(family: ScenarioFamily): Promise<ReplayResult> {
    assertReplayAllowed(this.env.NODE_ENV);

    const scenario = await this.load(family);
    const key = this.env.PAYLOAD_KEY_V1;
    if (key === undefined || key === '') {
      throw new ForbiddenException('PAYLOAD_KEY_V1 is not configured, so nothing can be stored.');
    }

    const masterKey = toKey(key);
    let checkoutsWritten = 0;
    let eventsWritten = 0;
    let duplicatesSkipped = 0;

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
          createdAt: new Date(checkout.createdAt),
          source: 'replay',
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) checkoutsWritten += 1;
    }

    for (const event of scenario.events) {
      const raw = JSON.stringify(event.body);
      const envelope = webhookEnvelopeSchema.parse(event.body);
      const sealed = seal(raw, masterKey, this.env.PAYLOAD_KEY_VERSION);
      const eventAt = toEventTime(envelope.created_at, new Date());

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

    return { family, checkoutsWritten, eventsWritten, duplicatesSkipped, detection };
  }

  /**
   * Removes everything a replay wrote, and nothing else.
   *
   * Scoped by `source`, so a demo run cannot take real events with it. Without this, the only
   * way to clear a scenario would be to guess at identifier prefixes.
   */
  async clear(): Promise<{ removed: number }> {
    assertReplayAllowed(this.env.NODE_ENV);

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
