import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  StatusDot,
  Tabs,
} from '@sentinel/ui';
import {
  incidentListResponseSchema,
  type IncidentListResponse,
  type IncidentSummary,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { ruleName } from '../incidents/evidence.js';
import './IncidentsPage.css';

type StatusFilter = 'all' | IncidentSummary['status'];
type Source = 'all' | IncidentSummary['source'];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'under_review', label: 'Review' },
  { id: 'contained', label: 'Contained' },
  { id: 'resolved', label: 'Resolved' },
];

const SOURCES: { id: Source; label: string }[] = [
  { id: 'all', label: 'Both' },
  { id: 'razorpay', label: 'Live' },
  { id: 'replay', label: 'Replayed' },
];

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
const HYPOTHESIS_LABEL: Record<IncidentSummary['primaryHypothesis'], string> = {
  attack: 'Likely abuse',
  outage: 'Gateway / outage',
  retry_storm: 'Retry storm',
  healthy_traffic: 'Healthy traffic',
  insufficient_evidence: 'Insufficient evidence',
};
const DECISION_LABEL: Record<IncidentSummary['recommendedDecision'], string> = {
  contain: 'Contain eligible',
  review: 'Review required',
  monitor: 'Monitor',
  none: 'No action',
};
const DECISION_TONE: Record<
  IncidentSummary['recommendedDecision'],
  'critical' | 'warn' | 'ok' | 'neutral'
> = {
  contain: 'critical',
  review: 'warn',
  monitor: 'ok',
  none: 'neutral',
};

async function fetchIncidents(status: StatusFilter, source: Source): Promise<IncidentListResponse> {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (source !== 'all') params.set('source', source);
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  const response = await fetch(`/api/incidents${query}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentListResponseSchema.parse(await response.json());
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

function Table({ incidents }: { incidents: IncidentSummary[] }): React.JSX.Element {
  return (
    <div className="inc-table-wrap">
      <table className="inc-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Entity</th>
            <th>Risk type</th>
            <th>Activity</th>
            <th>Decision</th>
            <th>Status</th>
            <th>Detected in</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id}>
              <td>
                <Badge tone={SEVERITY_TONE[incident.severity]} size="sm">
                  {incident.severity}
                </Badge>
              </td>
              <td>
                <div className="inc-entity">
                  <span className="inc-entity__kind">
                    {incident.entityKind}
                    {incident.source === 'replay' && <em> · replayed</em>}
                  </span>
                  <code>{incident.entityKey.replace(/^v\d+:/, '').slice(0, 18)}</code>
                </div>
              </td>
              <td>
                <StatusDot tone={STATUS_TONE[incident.status]}>
                  {STATUS_LABEL[incident.status]}
                </StatusDot>
              </td>
              <td>
                <strong>{HYPOTHESIS_LABEL[incident.primaryHypothesis]}</strong>
                <span className="inc-band">
                  score {incident.score.toFixed(2)}
                  {incident.band !== 'high' ? ' · wide range' : ''}
                </span>
              </td>
              <td>
                <strong>{incident.failures} failed</strong>
                <span className="inc-band">of {incident.attempts} attempts</span>
              </td>
              <td>
                <Badge tone={DECISION_TONE[incident.recommendedDecision] ?? 'neutral'} size="sm">
                  {DECISION_LABEL[incident.recommendedDecision]}
                </Badge>
                <span className="inc-band">
                  {incident.firedRules.length > 0
                    ? `${ruleName(incident.firedRules[0]!)} signal`
                    : 'model signal'}
                </span>
              </td>
              <td className="inc-ttd">{duration(incident.timeToDetectMs)}</td>
              <td className="inc-openc">
                <Link to="/console/incidents/$id" params={{ id: incident.id }} className="inc-open">
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

function Toolbar({
  status,
  setStatus,
  source,
  setSource,
}: {
  status: StatusFilter;
  setStatus: (s: StatusFilter) => void;
  source: Source;
  setSource: (s: Source) => void;
}): React.JSX.Element {
  return (
    <div className="inc-toolbar">
      <Tabs items={FILTERS} active={status} onChange={(id) => setStatus(id as StatusFilter)} />
      <div className="inc-source" role="group" aria-label="Traffic source">
        {SOURCES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === source ? 'is-active' : undefined}
            aria-pressed={option.id === source}
            onClick={() => setSource(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IncidentsPage(): React.JSX.Element {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<Source>('all');
  const client = useQueryClient();

  const incidents = useQuery({
    queryKey: ['incidents', status, source],
    queryFn: () => fetchIncidents(status, source),
    refetchInterval: 20_000,
  });

  const evaluate = useMutation({
    mutationFn: async () => {
      const scope = source === 'all' ? '' : `?source=${source}`;
      const response = await fetch(`/api/incidents/evaluate${scope}`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders(),
      });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      return response.json();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['incidents'] }),
  });

  const list = incidents.data?.incidents ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Monitor"
        title="Incidents"
        description="One episode per row, not one alert per attempt — each carries the evidence that opened it, the model's opinion, and the decision the rules and model reached together."
        actions={
          <Button
            variant="secondary"
            icon="↻"
            onClick={() => evaluate.mutate()}
            disabled={evaluate.isPending}
          >
            {evaluate.isPending ? 'Running…' : 'Run detection'}
          </Button>
        }
      />

      <Toolbar status={status} setStatus={setStatus} source={source} setSource={setSource} />

      <div className="inc-panel">
        {incidents.isPending ? (
          <Loading label="Loading incidents…" />
        ) : incidents.isError ? (
          <ErrorState message={incidents.error.message} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="🛡"
            title="Nothing in the queue"
            description="No incidents match this filter. Run a simulation to open a case, or wait for live traffic."
            action={
              <Link to="/console/scenarios">
                <Button size="sm">Go to Simulation</Button>
              </Link>
            }
          />
        ) : (
          <Table incidents={list} />
        )}
      </div>

      {incidents.data !== undefined && list.length > 0 && (
        <p className="inc-meta">
          Judged by threshold set <code>{incidents.data.thresholdHash}</code>. A score means nothing
          without what it was compared against.
        </p>
      )}
    </>
  );
}
