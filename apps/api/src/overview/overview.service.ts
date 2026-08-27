import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { canonicalEvents, incidents, type DbHandle } from '@sentinel/db';
import type { OverviewResponse } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';

type Window = OverviewResponse['window'];

const windowMs: Record<Window, number> = {
  today: 24 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

const n = (value: unknown): number => Number(value ?? 0);

@Injectable()
export class OverviewService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async get(window: Window): Promise<OverviewResponse> {
    const now = new Date();
    const start = new Date(now.getTime() - windowMs[window]!);
    const events = await this.events(start);
    const incidentCounts = await this.incidentCounts();
    const reasonRows = await this.reasonRows(start);

    const failures = events.filter((event) => event.status === 'failed').length;
    const captured = events.filter((event) => event.status === 'captured').length;
    const assessed = events.filter((event) => event.status !== null).length;
    const risk = assessed === 0 ? 0 : failures / assessed;

    return {
      window,
      generatedAt: now.toISOString(),
      source: 'razorpay',
      eventsAnalyzed: events.length,
      paymentsCaptured: captured,
      paymentsFailed: failures,
      activeIncidents: incidentCounts.open + incidentCounts.underReview,
      underReview: incidentCounts.underReview,
      contained: incidentCounts.contained,
      // This is deliberately an outcome count, not a claim that every successful payment is
      // fraud-free. It is the number of canonical payment outcomes not marked failed.
      safe: Math.max(assessed - failures, 0),
      risk,
      riskTrend: this.trend(events, start, window),
      recentEvents: events.slice(0, 8).map((event) => ({
        ...event,
        risk: event.status === 'failed' ? 1 : event.status === 'captured' ? 0 : 0.5,
        riskBasis: event.status === null ? 'unassessed' : 'payment-outcome',
      })),
      topRiskReasons: reasonRows,
    };
  }

  private async events(start: Date) {
    const rows = await this.handle.db
      .select({
        id: canonicalEvents.id,
        eventType: canonicalEvents.eventType,
        orderId: canonicalEvents.razorpayOrderId,
        paymentId: canonicalEvents.razorpayPaymentId,
        status: canonicalEvents.status,
        amountPaise: canonicalEvents.amountPaise,
        eventAt: canonicalEvents.eventAt,
      })
      .from(canonicalEvents)
      .where(and(eq(canonicalEvents.source, 'razorpay'), gte(canonicalEvents.eventAt, start)))
      .orderBy(desc(canonicalEvents.eventAt))
      .limit(10_000);

    return rows.map((row) => ({ ...row, eventAt: row.eventAt.toISOString() }));
  }

  private async incidentCounts() {
    const rows = await this.handle.db
      .select({ status: incidents.status, count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(inArray(incidents.source, ['razorpay']))
      .groupBy(incidents.status);

    const counts = { open: 0, underReview: 0, contained: 0 };
    for (const row of rows) {
      if (row.status === 'open') counts.open = n(row.count);
      if (row.status === 'under_review') counts.underReview = n(row.count);
      if (row.status === 'contained') counts.contained = n(row.count);
    }
    return counts;
  }

  private async reasonRows(start: Date) {
    const rows = await this.handle.db
      .select({ evidence: incidents.evidence })
      .from(incidents)
      .where(and(eq(incidents.source, 'razorpay'), gte(incidents.detectedAt, start)));
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!Array.isArray(row.evidence)) continue;
      for (const evidence of row.evidence) {
        if (typeof evidence !== 'object' || evidence === null || !('code' in evidence)) continue;
        const code = (evidence as { code?: unknown }).code;
        if (typeof code === 'string') counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private trend(
    events: Awaited<ReturnType<OverviewService['events']>>,
    start: Date,
    window: Window,
  ) {
    const bucketMs = window === '7d' ? 24 * 60 * 60_000 : 60 * 60_000;
    const buckets = new Map<number, { events: number; failures: number }>();
    for (const event of events) {
      const at = Math.floor(Date.parse(event.eventAt) / bucketMs) * bucketMs;
      const bucket = buckets.get(at) ?? { events: 0, failures: 0 };
      bucket.events += 1;
      if (event.status === 'failed') bucket.failures += 1;
      buckets.set(at, bucket);
    }
    const first = Math.floor(start.getTime() / bucketMs) * bucketMs;
    const last = Math.floor(Date.now() / bucketMs) * bucketMs;
    const result = [];
    for (let at = first; at <= last; at += bucketMs) {
      const bucket = buckets.get(at) ?? { events: 0, failures: 0 };
      result.push({
        at: new Date(at).toISOString(),
        events: bucket.events,
        failures: bucket.failures,
        risk: bucket.events === 0 ? 0 : bucket.failures / bucket.events,
      });
    }
    return result.slice(-48);
  }
}
