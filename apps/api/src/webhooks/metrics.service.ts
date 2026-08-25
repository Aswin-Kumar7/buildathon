import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { canonicalEvents, inboxEvents, type DbHandle } from '@sentinel/db';
import type { IngestionMetrics } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { IngestService } from './ingest.service.js';

const RATE_WINDOW_MINUTES = 5;

/**
 * Aggregates come back as numbers, strings or null depending on the driver, and a
 * `count(*)` over an empty table is null rather than zero. Normalising in one place keeps
 * that from becoming a `??` at every use.
 */
const count = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

const date = (value: Date | string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

@Injectable()
export class WebhookMetricsService {
  private readonly env = loadEnv();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ingest: IngestService,
  ) {}

  /**
   * One query per table rather than a single joined one.
   *
   * The health page is read by a human a few times a minute, so two round trips cost
   * nothing, and a joined aggregate over two tables of different cardinality is the kind
   * of query that quietly double-counts.
   */
  async collect(now: Date = new Date()): Promise<IngestionMetrics> {
    const inbox = await this.inboxTotals(new Date(now.getTime() - RATE_WINDOW_MINUTES * 60_000));
    const canonical = await this.canonicalTotal();
    const watermark = await this.ingest.watermark();

    return {
      configured: this.ingest.isConfigured,
      eventsStored: inbox.total,
      canonicalEvents: canonical,

      duplicateDeliveries: inbox.duplicates,
      // Denominator is every delivery, not every stored event, so the figure answers
      // "what share of what Razorpay sent us was a repeat".
      duplicateRate:
        inbox.total + inbox.duplicates === 0
          ? 0
          : inbox.duplicates / (inbox.total + inbox.duplicates),

      eventsPerMinute: inbox.recent / RATE_WINDOW_MINUTES,
      pendingDepth: inbox.pending,
      deadLetterDepth: inbox.dead,
      lateEvents: inbox.late,

      lastEventReceivedAt: inbox.lastReceivedAt?.toISOString() ?? null,
      // Age of the oldest thing still waiting — the number that says whether the drain is
      // keeping up, which a mean processing time would hide.
      oldestPendingAgeMs:
        inbox.oldestPendingAt === null ? null : now.getTime() - inbox.oldestPendingAt.getTime(),
      meanProcessingMs: inbox.meanProcessingMs,

      watermark: watermark?.toISOString() ?? null,
      allowedLatenessMinutes: this.env.ALLOWED_LATENESS_MINUTES,
      maxAttempts: this.env.INBOX_MAX_ATTEMPTS,
    };
  }

  private async canonicalTotal(): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(canonicalEvents);
    return count(row?.total);
  }

  private async inboxTotals(windowStart: Date) {
    const [row] = await this.handle.db
      .select({
        total: sql<number>`count(*)::int`,
        // Every delivery beyond the first is a duplicate Razorpay sent us. Counting them
        // is the only way to know whether deduplication is doing anything.
        duplicates: sql<number>`coalesce(sum(${inboxEvents.deliveryCount} - 1), 0)::int`,
        pending: sql<number>`count(*) filter (where ${inboxEvents.status} = 'pending')::int`,
        dead: sql<number>`count(*) filter (where ${inboxEvents.status} = 'dead')::int`,
        late: sql<number>`count(*) filter (where ${inboxEvents.late})::int`,
        // An ISO string with an explicit cast, not a Date. Interpolating a Date into a
        // `sql` template gives the driver a parameter with no column to infer a type
        // from: PGlite shrugs and coerces it, postgres.js throws. The unit suite runs on
        // the former, so this only appeared against a real server.
        recent: sql<number>`count(*) filter (where ${inboxEvents.receivedAt} >= ${windowStart.toISOString()}::timestamptz)::int`,
        lastReceivedAt: sql<Date | null>`max(${inboxEvents.receivedAt})`,
        oldestPendingAt: sql<Date | null>`min(${inboxEvents.receivedAt}) filter (where ${inboxEvents.status} = 'pending')`,
        // greatest(..., 0) as a floor. Both timestamps now come from the database and a
        // negative interval should be impossible, but a metric that can render a negative
        // duration is a metric nobody trusts afterwards — and rows written before the fix
        // are still in the table.
        meanProcessingMs: sql<
          number | null
        >`avg(greatest(extract(epoch from (${inboxEvents.processedAt} - ${inboxEvents.receivedAt})) * 1000, 0))`,
      })
      .from(inboxEvents);

    return {
      total: count(row?.total),
      duplicates: count(row?.duplicates),
      pending: count(row?.pending),
      dead: count(row?.dead),
      late: count(row?.late),
      recent: count(row?.recent),
      lastReceivedAt: date(row?.lastReceivedAt),
      oldestPendingAt: date(row?.oldestPendingAt),
      // Distinct from the counts: no processed rows yet means "unknown", not zero
      // milliseconds, and showing 0ms would read as instant rather than as no data.
      meanProcessingMs:
        row?.meanProcessingMs === null || row?.meanProcessingMs === undefined
          ? null
          : Number(row.meanProcessingMs),
    };
  }
}
