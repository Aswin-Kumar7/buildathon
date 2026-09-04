import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { incidents, type DbHandle } from '@sentinel/db';
import type { IncidentSummary, OverviewResponse } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { AttemptsService } from '../attempts/attempts.service.js';
import { IncidentsService } from '../incidents/incidents.service.js';

type Window = OverviewResponse['window'];
type Source = 'razorpay' | 'replay' | 'all';

const windowMs: Record<Window, number> = {
  today: 24 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

const n = (value: unknown): number => Number(value ?? 0);

@Injectable()
export class OverviewService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly attempts: AttemptsService,
    private readonly incidents: IncidentsService,
  ) {}

  async get(window: Window, source: Source = 'razorpay'): Promise<OverviewResponse> {
    const now = new Date();
    const start = new Date(now.getTime() - windowMs[window]!);
    const priorStart = new Date(start.getTime() - windowMs[window]!);

    const orders = (await this.attempts.listOrders(10_000, { source })).orders;
    const attemptRows = orders.flatMap((order) => order.attempts);
    const current = attemptRows.filter(
      (attempt) => Date.parse(attempt.firstSeenAt) >= start.getTime(),
    );
    const prior = attemptRows.filter((attempt) => {
      const at = Date.parse(attempt.firstSeenAt);
      return at >= priorStart.getTime() && at < start.getTime();
    });
    // The one delta that is honestly computable from timestamps we hold. Null when there is no
    // prior window to compare against — never a fabricated percentage.
    const attemptsDeltaPct =
      prior.length === 0 ? null : (current.length - prior.length) / prior.length;

    const incidentStats = await this.incidentStats(source);
    // Incidents are shown as current state, not windowed: an open case from yesterday still needs
    // review today. Only the attempt counts and the time series below are windowed.
    const allIncidents = (
      await this.incidents.list(undefined, source === 'all' ? undefined : source)
    ).incidents;
    const recentIncidents = [...allIncidents]
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .slice(0, 5);
    const reasonRows = OverviewService.reasonsByTitle(allIncidents);
    const trendRows = await this.riskRows(start, source);

    const failures = current.filter((attempt) => attempt.status === 'failed').length;
    const captured = current.filter((attempt) => attempt.status === 'captured').length;
    const assessed = current.length;
    // The risk meter reflects the worst still-open incident, not a windowed snapshot.
    const openRisk = allIncidents.filter(
      (incident) => incident.status === 'open' || incident.status === 'under_review',
    );
    const risk = openRisk.length === 0 ? null : Math.max(...openRisk.map((i) => i.score));
    const riskLevel =
      openRisk.length === 0
        ? null
        : openRisk.some((i) => i.severity === 'high')
          ? 'high'
          : openRisk.some((i) => i.severity === 'medium')
            ? 'medium'
            : 'low';

    return {
      window,
      generatedAt: now.toISOString(),
      source,
      eventsAnalyzed: assessed,
      attemptsToday: current.length,
      attemptsDeltaPct,
      paymentsCaptured: captured,
      paymentsFailed: failures,
      activeIncidents: incidentStats.open + incidentStats.underReview,
      underReview: incidentStats.underReview,
      contained: incidentStats.contained,
      totalIncidents: incidentStats.total,
      resolvedToday: incidentStats.resolved,
      // This is deliberately an outcome count, not a claim that every successful payment is
      // fraud-free. It is the number of canonical payment outcomes not marked failed.
      safe: Math.max(assessed - failures, 0),
      risk,
      riskLevel,
      riskTrend: this.trend(current, trendRows, start, window),
      topRiskReasons: reasonRows,
      recentIncidents,
    };
  }

  private async incidentStats(source: Source) {
    const scope = source === 'all' ? sql`true` : eq(incidents.source, source);
    const rows = await this.handle.db
      .select({ status: incidents.status, count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(scope)
      .groupBy(incidents.status);
    const [totalRow] = await this.handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(scope);

    const counts = {
      total: n(totalRow?.count),
      open: 0,
      underReview: 0,
      contained: 0,
      resolved: 0,
    };
    for (const row of rows) {
      if (row.status === 'open') counts.open = n(row.count);
      if (row.status === 'under_review') counts.underReview = n(row.count);
      if (row.status === 'contained') counts.contained = n(row.count);
      if (row.status === 'resolved') counts.resolved = n(row.count);
    }
    return counts;
  }

  /** Groups live incidents by their derived title, the merchant-facing "why". */
  private static reasonsByTitle(
    incidentList: readonly IncidentSummary[],
  ): { code: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const incident of incidentList) {
      counts.set(incident.title, (counts.get(incident.title) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private async riskRows(start: Date, source: Source) {
    return this.handle.db
      .select({
        score: incidents.score,
        severity: incidents.severity,
        detectedAt: incidents.detectedAt,
      })
      .from(incidents)
      .where(
        and(
          source === 'all' ? undefined : eq(incidents.source, source),
          gte(incidents.detectedAt, start),
        ),
      );
  }

  /**
   * The time series behind the overview chart.
   *
   * Every series here used to come from the incidents table: `events` counted incidents while the
   * chart labelled it "attempts", and `failures` was never written at all, so the client invented a
   * blocked count from the incident count to have something red to draw. Attempts now come from the
   * attempt rows and incidents are their own series, so each line means what its name says.
   */
  private trend(
    attemptRows: { firstSeenAt: string; status: string }[],
    incidentRows: Awaited<ReturnType<OverviewService['riskRows']>>,
    start: Date,
    window: Window,
  ) {
    const bucketMs = window === '7d' || window === '30d' ? 24 * 60 * 60_000 : 60 * 60_000;
    const empty = () => ({ events: 0, failures: 0, incidents: 0, risk: 0 });
    const buckets = new Map<number, ReturnType<typeof empty>>();
    const at = (ms: number): ReturnType<typeof empty> => {
      const key = Math.floor(ms / bucketMs) * bucketMs;
      const bucket = buckets.get(key) ?? empty();
      buckets.set(key, bucket);
      return bucket;
    };

    for (const attempt of attemptRows) {
      const bucket = at(Date.parse(attempt.firstSeenAt));
      bucket.events += 1;
      if (attempt.status === 'failed') bucket.failures += 1;
    }
    for (const incident of incidentRows) {
      const bucket = at(incident.detectedAt.getTime());
      bucket.incidents += 1;
      bucket.risk = Math.max(bucket.risk, incident.score);
    }

    const first = Math.floor(start.getTime() / bucketMs) * bucketMs;
    const last = Math.floor(Date.now() / bucketMs) * bucketMs;
    const result = [];
    for (let key = first; key <= last; key += bucketMs) {
      const bucket = buckets.get(key) ?? empty();
      result.push({ at: new Date(key).toISOString(), ...bucket });
    }
    return result.slice(-48);
  }
}
