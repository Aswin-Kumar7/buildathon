import { useQuery } from '@tanstack/react-query';
import { Callout, Card } from '@sentinel/ui';
import { ingestionMetricsSchema, type IngestionMetrics } from '@sentinel/contracts';
import './HealthPage.css';

const REFRESH_MS = 5_000;

async function fetchMetrics(): Promise<IngestionMetrics> {
  const response = await fetch('/api/ingestion/metrics', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return ingestionMetricsSchema.parse(await response.json());
}

function ago(iso: string | null): string {
  if (iso === null) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'ok' | 'warn' | 'critical' | undefined;
}): React.JSX.Element {
  return (
    <div className={`metric${tone === undefined ? '' : ` metric--${tone}`}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note !== undefined && <p className="metric__note">{note}</p>}
    </div>
  );
}

export function HealthPage(): React.JSX.Element {
  const metrics = useQuery({
    queryKey: ['ingestion-metrics'],
    queryFn: fetchMetrics,
    refetchInterval: REFRESH_MS,
  });

  return (
    <>
      <header className="page-head">
        <h1>System health</h1>
        <p>
          Webhook ingestion, as it actually is. These numbers come from the database, not from a
          counter held in memory that a restart would reset.
        </p>
      </header>

      {metrics.isError && (
        <Callout tone="critical" title="Could not read ingestion metrics">
          <p role="alert">{metrics.error.message}</p>
        </Callout>
      )}

      {metrics.isPending && <p role="status">Reading ingestion metrics…</p>}

      {metrics.data !== undefined && <Health metrics={metrics.data} />}
    </>
  );
}

/**
 * Stated first, and separately from the numbers. An unconfigured webhook and a healthy
 * idle one produce identical zeroes, so a dashboard that only shows counts reports
 * "all quiet" throughout an outage.
 */
function Configuration({ metrics }: { metrics: IngestionMetrics }): React.JSX.Element {
  if (!metrics.configured) {
    return (
      <Callout tone="critical" title="Webhook ingestion is not configured">
        <p>
          <code>RAZORPAY_WEBHOOK_SECRET</code> or <code>PAYLOAD_KEY_V1</code> is missing, so the
          endpoint refuses every delivery rather than storing customer data unencrypted. The zeroes
          below mean &ldquo;nothing can arrive&rdquo;, not &ldquo;nothing is happening&rdquo;.
        </p>
      </Callout>
    );
  }

  return (
    <Callout tone="ok" title="Webhook ingestion is configured">
      <p>
        Deliveries are verified against the shared secret and stored before they are acknowledged.
        Watermark is at {metrics.watermark ?? 'no events yet'}, which is{' '}
        {metrics.allowedLatenessMinutes} minutes behind the newest event we have seen.
      </p>
    </Callout>
  );
}

function Ingestion({ metrics }: { metrics: IngestionMetrics }): React.JSX.Element {
  return (
    <section>
      <h2>Ingestion</h2>
      <dl className="metrics">
        <Metric
          label="Events stored"
          value={String(metrics.eventsStored)}
          note="From Razorpay, after deduplication"
        />
        {/*
          Shown beside the real figure rather than folded into it. This page is where the
          ingestion claim gets read, and a replayed scenario inflating it would make the claim
          worth nothing.
        */}
        <Metric
          label="Replayed"
          value={String(metrics.replayedEvents)}
          note="Synthetic, never counted as evidence"
        />
        <Metric
          label="Arriving"
          value={`${metrics.eventsPerMinute.toFixed(1)}/min`}
          note="Averaged over the last five minutes"
        />
        <Metric label="Last delivery" value={ago(metrics.lastEventReceivedAt)} />
        <Metric
          label="Duplicates"
          value={`${(metrics.duplicateRate * 100).toFixed(1)}%`}
          note={`${metrics.duplicateDeliveries} repeat deliveries, all discarded`}
        />
      </dl>
    </section>
  );
}

function Processing({ metrics }: { metrics: IngestionMetrics }): React.JSX.Element {
  const behind = metrics.oldestPendingAgeMs !== null && metrics.oldestPendingAgeMs > 30_000;

  return (
    <section>
      <h2>Processing</h2>
      <dl className="metrics">
        <Metric
          label="Waiting"
          value={String(metrics.pendingDepth)}
          tone={behind ? 'warn' : undefined}
          note={
            metrics.oldestPendingAgeMs === null
              ? 'Nothing waiting'
              : `Oldest has waited ${duration(metrics.oldestPendingAgeMs)}`
          }
        />
        <Metric
          label="Canonical events"
          value={String(metrics.canonicalEvents)}
          note="Redacted; the only form anything downstream reads"
        />
        <Metric
          label="Mean processing"
          value={duration(metrics.meanProcessingMs)}
          note="Arrival to redaction"
        />
        <Metric
          label="Dead-lettered"
          value={String(metrics.deadLetterDepth)}
          tone={metrics.deadLetterDepth > 0 ? 'critical' : undefined}
          note={`Gave up after ${metrics.maxAttempts} attempts`}
        />
      </dl>
    </section>
  );
}

function Lateness({ metrics }: { metrics: IngestionMetrics }): React.JSX.Element {
  return (
    <section>
      <h2>Late arrivals</h2>
      <Card>
        <p>
          <strong>{metrics.lateEvents}</strong>{' '}
          {metrics.lateEvents === 1 ? 'event has' : 'events have'} arrived more than{' '}
          {metrics.allowedLatenessMinutes} minutes behind the watermark.
        </p>
        <p className="muted">
          Razorpay retries for 24 hours with no ordering guarantee, so this is routine rather than
          exceptional. A late event is recorded and counted, and it may correct analytics &mdash;
          but it never silently rewrites a decision that was already taken. History is append-only;
          corrections are new entries.
        </p>
      </Card>
    </section>
  );
}

function Health({ metrics }: { metrics: IngestionMetrics }): React.JSX.Element {
  return (
    <>
      <Configuration metrics={metrics} />
      <Ingestion metrics={metrics} />
      <Processing metrics={metrics} />
      <Lateness metrics={metrics} />
    </>
  );
}
