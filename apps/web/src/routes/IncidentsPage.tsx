import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge, Button, Callout, Card } from '@sentinel/ui';
import {
  incidentListResponseSchema,
  type IncidentListResponse,
  type IncidentSummary,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { suggestedAction, ruleName } from '../incidents/evidence.js';
import './IncidentsPage.css';

type StatusFilter = 'all' | IncidentSummary['status'];
type Source = 'all' | IncidentSummary['source'];

const SOURCE_LABEL: Record<Source, string> = {
  all: 'Both',
  razorpay: 'Real traffic',
  replay: 'Replayed',
};

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under review' },
  { value: 'contained', label: 'Contained' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'expired', label: 'Expired' },
];

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
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

const SEVERITY_TONE = { high: 'critical', medium: 'warn', low: 'neutral' } as const;

const STATUS_LABEL: Record<IncidentSummary['status'], string> = {
  open: 'Open',
  under_review: 'Under review',
  contained: 'Contained',
  resolved: 'Resolved',
  expired: 'Expired',
};

function Row({ incident }: { incident: IncidentSummary }): React.JSX.Element {
  const expired = incident.status === 'expired' || incident.status === 'resolved';

  return (
    <Card>
      <header className="incident__head">
        <div>
          <Badge tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Badge>{' '}
          <Badge tone="neutral">{STATUS_LABEL[incident.status]}</Badge>{' '}
          {incident.source === 'replay' && <Badge tone="warn">replayed</Badge>}
        </div>
        <Link to="/console/incidents/$id" params={{ id: incident.id }}>
          Open
        </Link>
      </header>

      <p className="incident__what">
        {incident.entityKind} <code>{incident.entityKey.replace(/^v\d+:/, '').slice(0, 12)}</code>
      </p>

      <dl className="incident__facts">
        <div>
          <dt>Score</dt>
          <dd>
            {incident.score.toFixed(2)}
            <span className="incident__band">
              {incident.band === 'high'
                ? 'confident'
                : `could be ${incident.scoreLower.toFixed(2)}–${incident.scoreUpper.toFixed(2)}`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Time to detect</dt>
          <dd>{duration(incident.timeToDetectMs)}</dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{duration(incident.lastActivityAt - incident.firstAttemptAt)}</dd>
        </div>
        <div>
          <dt>{expired ? 'Expired' : 'Expires'}</dt>
          <dd>{new Date(incident.expiresAt).toLocaleTimeString()}</dd>
        </div>
      </dl>

      <p className="incident__rules">
        {incident.firedRules.map((rule) => ruleName(rule)).join(' · ')}
      </p>

      {/* A suggestion, labelled as one. Nothing in this console acts — containment and its
          approval arrive in a later slice, and implying otherwise would claim a power it
          does not have. */}
      <p className="incident__suggestion">
        <strong>Suggested:</strong> {suggestedAction(incident.severity, incident.firedRules)}
      </p>
    </Card>
  );
}

function Toolbar({
  status,
  setStatus,
  source,
  setSource,
  onEvaluate,
  evaluating,
}: {
  status: StatusFilter;
  setStatus: (status: StatusFilter) => void;
  source: Source;
  setSource: (source: Source) => void;
  onEvaluate: () => void;
  evaluating: boolean;
}): React.JSX.Element {
  return (
    <div className="incident-bar">
      <div className="kinds" role="group" aria-label="Status">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={filter.value === status ? 'is-current' : undefined}
            aria-pressed={filter.value === status}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Real and replayed kept apart, as everywhere else. Detection runs over whichever is
          being looked at: the feature window anchors to the newest event whatever its source,
          so evaluating both while showing one would hide a scenario behind a live attempt. */}
      <div className="kinds" role="group" aria-label="Traffic">
        {(['all', 'razorpay', 'replay'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={option === source ? 'is-current' : undefined}
            aria-pressed={option === source}
            onClick={() => setSource(option)}
          >
            {SOURCE_LABEL[option]}
          </button>
        ))}
      </div>

      <Button variant="ghost" onClick={onEvaluate} disabled={evaluating}>
        {evaluating ? 'Evaluating…' : 'Run detection'}
      </Button>
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
      // Detection runs over the traffic being looked at. Evaluating everything while showing
      // one source would let a replayed scenario be hidden behind a single live attempt — the
      // feature window anchors to the newest event, whichever source it came from.
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

  return (
    <>
      <header className="page-head">
        <h1>Incidents</h1>
        <p>
          One episode per row, not one alert per attempt. Every incident carries the evidence that
          opened it and the evidence against it, and nothing here has taken an action — the queue is
          for deciding, not for having decided.
        </p>
      </header>

      <Toolbar
        status={status}
        setStatus={setStatus}
        source={source}
        setSource={setSource}
        onEvaluate={() => evaluate.mutate()}
        evaluating={evaluate.isPending}
      />

      {incidents.isError && (
        <Callout tone="critical" title="Could not load incidents">
          <p role="alert">{incidents.error.message}</p>
        </Callout>
      )}

      {incidents.isPending && <p role="status">Loading incidents…</p>}

      {incidents.data !== undefined && incidents.data.incidents.length === 0 && (
        <Callout tone="neutral" title="Nothing here">
          <p>
            No incidents{status === 'all' ? '' : ` with status ${STATUS_LABEL[status]}`}. Replay a
            scenario and run detection, or wait for real traffic.
          </p>
        </Callout>
      )}

      {incidents.data !== undefined && incidents.data.incidents.length > 0 && (
        <>
          <p className="incident-meta">
            Judged by threshold set <code>{incidents.data.thresholdHash}</code>. A score means
            nothing without what it was compared against.
          </p>
          <section className="incidents">
            {incidents.data.incidents.map((incident) => (
              <Row key={incident.id} incident={incident} />
            ))}
          </section>
        </>
      )}
    </>
  );
}
