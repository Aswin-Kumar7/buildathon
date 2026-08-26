import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatCard,
  StatusDot,
} from '@sentinel/ui';
import {
  incidentListResponseSchema,
  riskModelMetricsResponseSchema,
  type IncidentListResponse,
  type IncidentSummary,
  type RiskModelMetrics,
  type RiskModelMetricsResponse,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import './OverviewPage.css';

async function fetchIncidents(): Promise<IncidentListResponse> {
  const response = await fetch('/api/incidents', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentListResponseSchema.parse(await response.json());
}

async function fetchModel(): Promise<RiskModelMetricsResponse> {
  const response = await fetch('/api/model/metrics', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return riskModelMetricsResponseSchema.parse(await response.json());
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

const SEVERITY_TONE = { high: 'critical', medium: 'warn', low: 'neutral' } as const;
const STATUS_TONE: Record<IncidentSummary['status'], 'critical' | 'warn' | 'ok' | 'neutral'> = {
  open: 'critical',
  under_review: 'warn',
  contained: 'ok',
  resolved: 'neutral',
  expired: 'neutral',
};
const STATUS_LABEL: Record<IncidentSummary['status'], string> = {
  open: 'Open',
  under_review: 'Under review',
  contained: 'Contained',
  resolved: 'Resolved',
  expired: 'Expired',
};

function shortEntity(incident: IncidentSummary): string {
  return incident.entityKey.replace(/^v\d+:/, '').slice(0, 14);
}

function RecentIncidents({ incidents }: { incidents: IncidentSummary[] }): React.JSX.Element {
  if (incidents.length === 0) {
    return (
      <EmptyState
        icon="✓"
        title="No incidents in the queue"
        description="Nothing is being flagged right now. Simulate an attack to watch the pipeline open, judge and act on a case end to end."
      />
    );
  }
  return (
    <div className="ov-table-wrap">
      <table className="ov-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Entity</th>
            <th>Status</th>
            <th>Risk</th>
            <th>Source</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {incidents.slice(0, 6).map((incident) => (
            <tr key={incident.id}>
              <td>
                <Badge tone={SEVERITY_TONE[incident.severity]} size="sm">
                  {incident.severity}
                </Badge>
              </td>
              <td>
                <span className="ov-entity">
                  <span className="ov-entity__kind">{incident.entityKind}</span>
                  <code>{shortEntity(incident)}</code>
                </span>
              </td>
              <td>
                <StatusDot tone={STATUS_TONE[incident.status]}>
                  {STATUS_LABEL[incident.status]}
                </StatusDot>
              </td>
              <td className="ov-num">{incident.score.toFixed(2)}</td>
              <td>
                {incident.source === 'replay' ? (
                  <Badge tone="neutral" size="sm">
                    replayed
                  </Badge>
                ) : (
                  <Badge tone="info" size="sm">
                    live
                  </Badge>
                )}
              </td>
              <td className="ov-open">
                <Link to="/console/incidents/$id" params={{ id: incident.id }}>
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Honest = RiskModelMetrics['honest'];

function Stats({
  counts,
  metrics,
}: {
  counts: IncidentListResponse['counts'] | undefined;
  metrics: Honest | null;
}): React.JSX.Element {
  const active = (counts?.open ?? 0) + (counts?.underReview ?? 0);
  return (
    <div className="ov-stats">
      <StatCard
        icon="🛡"
        tone={active > 0 ? 'critical' : 'ok'}
        label="Active incidents"
        value={counts ? active : '—'}
        hint={active > 0 ? 'need attention' : 'all clear'}
      />
      <StatCard
        icon="👤"
        tone="warn"
        label="Awaiting review"
        value={counts?.underReview ?? '—'}
        hint="in the queue"
      />
      <StatCard
        icon="🔒"
        tone="ok"
        label="Contained"
        value={counts?.contained ?? '—'}
        hint="threats stopped"
      />
      <StatCard
        icon="🎯"
        tone="accent"
        label="Detection recall"
        value={metrics ? pct(metrics.recall.point) : '—'}
        hint="of attacks caught"
      />
      <StatCard
        icon="🚦"
        tone="info"
        label="False-decline rate"
        value={metrics ? pct(metrics.falseDeclineRate) : '—'}
        hint="of good traffic"
      />
    </div>
  );
}

function ModelCard({ metrics }: { metrics: Honest | null }): React.JSX.Element {
  return (
    <Card title="Deployed model">
      {metrics === null ? (
        <p className="ov-muted">Model evaluation not generated.</p>
      ) : (
        <>
          <div className="ov-modelrow">
            {(
              [
                ['PR-AUC', metrics.prAuc.point.toFixed(3)],
                ['Precision', metrics.precision.point.toFixed(2)],
                ['Recall', metrics.recall.point.toFixed(2)],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <span className="ov-modellabel">{k}</span>
                <span className="ov-modelval">{v}</span>
              </div>
            ))}
          </div>
          <p className="ov-muted ov-modelnote">
            Card-testing risk model, measured on a held-out split. These are the deployed model’s
            own numbers.
          </p>
          <Link to="/console/metrics" className="ov-viewall">
            Model insights →
          </Link>
        </>
      )}
    </Card>
  );
}

function SystemCard({ serving }: { serving: boolean }): React.JSX.Element {
  return (
    <Card title="System">
      <ul className="ov-status">
        <li>
          <StatusDot tone="ok" pulse>
            Ingestion
          </StatusDot>
          <span className="ov-muted">operational</span>
        </li>
        <li>
          <StatusDot tone="ok">Detection pipeline</StatusDot>
          <span className="ov-muted">operational</span>
        </li>
        <li>
          <StatusDot tone={serving ? 'ok' : 'warn'}>Risk model</StatusDot>
          <span className="ov-muted">{serving ? 'serving' : 'degraded'}</span>
        </li>
      </ul>
      <Link to="/console/settings" className="ov-viewall">
        System health →
      </Link>
    </Card>
  );
}

export function OverviewPage(): React.JSX.Element {
  const client = useQueryClient();
  const incidents = useQuery({
    queryKey: ['incidents', 'all', 'all'],
    queryFn: fetchIncidents,
    refetchInterval: 15_000,
  });
  const model = useQuery({ queryKey: ['model-metrics'], queryFn: fetchModel });

  const simulate = useMutation({
    mutationFn: async () => {
      await fetch('/api/replay', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ family: 'attack_loud' }),
      });
      await fetch('/api/incidents/evaluate', {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders(),
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['incidents'] }),
  });

  const metrics = model.data?.available === true ? model.data.model.honest : null;

  return (
    <>
      <PageHeader
        eyebrow="Monitor"
        title="Overview"
        description="Live card-testing and abuse posture across your Razorpay checkout — the detector, the model and the queue, in one view."
        actions={
          <Button icon="⚡" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
            {simulate.isPending ? 'Simulating…' : 'Simulate attack'}
          </Button>
        }
      />

      <Stats counts={incidents.data?.counts} metrics={metrics} />

      <div className="ov-grid">
        <Card
          title="Incident queue"
          subtitle="The most recent episodes, newest first"
          actions={
            <Link to="/console/incidents" className="ov-viewall">
              View all →
            </Link>
          }
          variant="flush"
        >
          {incidents.isPending ? (
            <Loading label="Loading the queue…" />
          ) : incidents.isError ? (
            <ErrorState message={incidents.error.message} />
          ) : (
            <RecentIncidents incidents={incidents.data.incidents} />
          )}
        </Card>

        <div className="ov-side">
          <ModelCard metrics={metrics} />
          <SystemCard serving={metrics !== null} />
        </div>
      </div>
    </>
  );
}
