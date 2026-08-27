import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { canonicalEvents, incidents, type DbHandle } from '@sentinel/db';
import type { OverviewResponse } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { AttemptsService } from '../attempts/attempts.service.js';

type Window = OverviewResponse['window'];

const windowMs: Record<Window, number> = {
  today: 24 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

const n = (value: unknown): number => Number(value ?? 0);

@Injectable()
export class OverviewService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly attempts: AttemptsService,
  ) {}

  async get(window: Window): Promise<OverviewResponse> {
    const now = new Date();
    const start = new Date(now.getTime() - windowMs[window]!);
    const events = await this.events(start);
    const orders = (await this.attempts.listOrders(10_000, { source: 'razorpay' })).orders;
    const attempts = orders.flatMap((order) => order.attempts);
    const incidentCounts = await this.incidentCounts();
    const reasonRows = await this.reasonRows(start);
    const riskRows = await this.riskRows(start);

    const failures = attempts.filter((attempt) => attempt.status === 'failed').length;
    const captured = attempts.filter((attempt) => attempt.status === 'captured').length;
    const assessed = attempts.length;
    const risk = riskRows.length === 0 ? 0 : Math.max(...riskRows.map((row) => row.score));

    return {
      window,
      generatedAt: now.toISOString(),
      source: 'razorpay',
      eventsAnalyzed: assessed,
      paymentsCaptured: captured,
      paymentsFailed: failures,
      activeIncidents: incidentCounts.open + incidentCounts.underReview,
      underReview: incidentCounts.underReview,
      contained: incidentCounts.contained,
      // This is deliberately an outcome count, not a claim that every successful payment is
      // fraud-free. It is the number of canonical payment outcomes not marked failed.
      safe: Math.max(assessed - failures, 0),
      risk,
      riskTrend: this.trend(riskRows, start, window),
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
      .select({ arbitration: incidents.arbitration })
      .from(incidents)
      .where(and(eq(incidents.source, 'razorpay'), gte(incidents.detectedAt, start)));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const best =
        typeof row.arbitration === 'object' && row.arbitration !== null && 'best' in row.arbitration
          ? (row.arbitration as { best?: unknown }).best
          : 'insufficient_evidence';
      const code = typeof best === 'string' ? best : 'insufficient_evidence';
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private async riskRows(start: Date) {
    return this.handle.db
      .select({ score: incidents.score, detectedAt: incidents.detectedAt })
      .from(incidents)
      .where(and(eq(incidents.source, 'razorpay'), gte(incidents.detectedAt, start)));
  }

  private trend(
    rows: Awaited<ReturnType<OverviewService['riskRows']>>,
    start: Date,
    window: Window,
  ) {
    const bucketMs = window === '7d' ? 24 * 60 * 60_000 : 60 * 60_000;
    const buckets = new Map<number, { events: number; failures: number; risk: number }>();
    for (const row of rows) {
      const at = Math.floor(row.detectedAt.getTime() / bucketMs) * bucketMs;
      const bucket = buckets.get(at) ?? { events: 0, failures: 0, risk: 0 };
      bucket.events += 1;
      bucket.risk = Math.max(bucket.risk, row.score);
      buckets.set(at, bucket);
    }
    const first = Math.floor(start.getTime() / bucketMs) * bucketMs;
    const last = Math.floor(Date.now() / bucketMs) * bucketMs;
    const result = [];
    for (let at = first; at <= last; at += bucketMs) {
      const bucket = buckets.get(at) ?? { events: 0, failures: 0, risk: 0 };
      result.push({
        at: new Date(at).toISOString(),
        events: bucket.events,
        failures: bucket.failures,
        risk: bucket.risk,
      });
    }
    return result.slice(-48);
  }
}
