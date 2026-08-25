import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { and, asc, eq, lt, isNotNull, sql } from 'drizzle-orm';
import { canonicalEvents, inboxEvents, type DbHandle } from '@sentinel/db';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { open, toKey, type SealedPayload } from '../telemetry/envelope.js';
import { toCanonical, webhookEnvelopeSchema } from './redact.js';

export interface DrainReport {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
}

/**
 * Drains the inbox: takes each stored event, derives its redacted canonical form, and
 * marks it done.
 *
 * Deliberately separate from ingestion. The webhook handler's only job is to make the
 * event durable inside Razorpay's five-second window; everything that could be slow, fail
 * or need retrying happens here, where taking longer costs nothing and a crash loses no
 * data.
 *
 * At-least-once, so this must be idempotent: the canonical insert carries a unique
 * constraint on the inbox row and does nothing on conflict. Draining the same event twice
 * — after a restart, a duplicate delivery, or a crash between the write and the status
 * update — produces exactly one canonical event.
 */
@Injectable()
export class DrainService implements OnModuleDestroy {
  private readonly env = loadEnv();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Started explicitly rather than on module init. A timer that starts itself runs during
   * every test that boots the application, turning "did the drain process this row?" into
   * a race against a background tick.
   */
  start(): void {
    const interval = this.env.INBOX_DRAIN_INTERVAL_MS;
    if (interval === 0 || this.timer !== undefined) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** Skips rather than queues when a pass is still running, so a slow batch cannot pile up. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (error) {
      console.warn('drain: pass failed', error instanceof Error ? error.message : error);
    } finally {
      this.running = false;
    }
  }

  async drainOnce(): Promise<DrainReport> {
    const pending = await this.handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.status, 'pending'))
      .orderBy(asc(inboxEvents.receivedAt))
      .limit(this.env.INBOX_BATCH_SIZE);

    const report: DrainReport = {
      claimed: pending.length,
      processed: 0,
      failed: 0,
      deadLettered: 0,
    };

    for (const row of pending) {
      try {
        await this.process(row);
        report.processed += 1;
      } catch (error) {
        const dead = await this.recordFailure(row.id, row.attempts, error);
        report.failed += 1;
        if (dead) report.deadLettered += 1;
      }
    }

    return report;
  }

  private async process(row: typeof inboxEvents.$inferSelect): Promise<void> {
    if (row.ciphertext === null || row.purgedAt !== null) {
      // Retrying will never succeed — the bytes are gone. Fail it straight to the
      // dead-letter queue rather than burning three attempts on it.
      throw new Error('payload was purged before it was processed');
    }

    const sealed: SealedPayload = {
      ciphertext: row.ciphertext,
      iv: row.iv ?? '',
      authTag: row.authTag ?? '',
      wrappedKey: row.wrappedKey ?? '',
      wrappedKeyIv: row.wrappedKeyIv ?? '',
      wrappedKeyTag: row.wrappedKeyTag ?? '',
      keyVersion: row.keyVersion ?? 1,
    };

    const key = this.env.PAYLOAD_KEY_V1;
    if (key === undefined || key === '') throw new Error('PAYLOAD_KEY_V1 is not configured');

    // The plaintext lives in this function and nowhere else: it is not logged, not
    // returned, and not attached to any error raised from here.
    const envelope = webhookEnvelopeSchema.parse(JSON.parse(open(sealed, toKey(key))));
    const canonical = toCanonical(envelope, row.receivedAt);

    await this.handle.db
      .insert(canonicalEvents)
      .values({
        inboxEventId: row.id,
        razorpayEventId: row.razorpayEventId,
        ...canonical,
        receivedAt: row.receivedAt,
        late: row.late,
      })
      .onConflictDoNothing({ target: canonicalEvents.inboxEventId });

    await this.handle.db
      .update(inboxEvents)
      .set({ status: 'processed', processedAt: new Date(), attempts: row.attempts + 1 })
      .where(eq(inboxEvents.id, row.id));
  }

  /** Returns whether this failure exhausted the row's attempts. */
  private async recordFailure(id: string, attempts: number, error: unknown): Promise<boolean> {
    const next = attempts + 1;
    const dead = next >= this.env.INBOX_MAX_ATTEMPTS;

    // The message only — never the payload, and never the decrypted body, which would put
    // customer data into an error column that everything can read.
    const message = error instanceof Error ? error.message : 'unknown error';

    await this.handle.db
      .update(inboxEvents)
      .set({ attempts: next, lastError: message.slice(0, 500), status: dead ? 'dead' : 'pending' })
      .where(eq(inboxEvents.id, id));

    return dead;
  }

  /**
   * Drops ciphertext past the forensic retention window.
   *
   * The row itself stays: deduplication depends on the event id being present forever, and
   * the canonical event is what anything downstream reads anyway. Only the encrypted
   * customer data goes.
   */
  async purgeExpiredPayloads(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.FORENSIC_RETENTION_DAYS * 86_400_000);

    const purged = await this.handle.db
      .update(inboxEvents)
      .set({
        ciphertext: null,
        iv: null,
        authTag: null,
        wrappedKey: null,
        wrappedKeyIv: null,
        wrappedKeyTag: null,
        purgedAt: now,
      })
      .where(
        and(
          lt(inboxEvents.receivedAt, cutoff),
          isNotNull(inboxEvents.ciphertext),
          eq(inboxEvents.status, 'processed'),
        ),
      )
      .returning();

    return purged.length;
  }

  /** Puts a dead-lettered row back in the queue with its attempt count reset. */
  async retryDeadLettered(id: string): Promise<boolean> {
    const updated = await this.handle.db
      .update(inboxEvents)
      .set({ status: 'pending', attempts: 0, lastError: null })
      .where(and(eq(inboxEvents.id, id), eq(inboxEvents.status, 'dead')))
      .returning();

    return updated.length > 0;
  }

  async depth(): Promise<{ pending: number; dead: number }> {
    const [row] = await this.handle.db
      .select({
        pending: sql<number>`count(*) filter (where ${inboxEvents.status} = 'pending')::int`,
        dead: sql<number>`count(*) filter (where ${inboxEvents.status} = 'dead')::int`,
      })
      .from(inboxEvents);

    return { pending: row?.pending ?? 0, dead: row?.dead ?? 0 };
  }
}
