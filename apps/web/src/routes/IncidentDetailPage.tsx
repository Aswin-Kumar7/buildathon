import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge, Button, Callout, Card } from '@sentinel/ui';
import {
  incidentDetailResponseSchema,
  type EvidenceDto,
  type IncidentDetail,
  type IncidentStatusDto,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { ABSTENTION_REASON, phraseFor, ruleName, suggestedAction } from '../incidents/evidence.js';
import { ContainmentPanel } from '../incidents/ContainmentPanel.js';
import './IncidentsPage.css';

async function fetchIncident(id: string): Promise<IncidentDetail> {
  const response = await fetch(`/api/incidents/${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentDetailResponseSchema.parse(await response.json()).incident;
}

/** What an analyst may do from here. Kept in step with the state machine the API enforces. */
const NEXT: Record<IncidentStatusDto, IncidentStatusDto[]> = {
  open: ['under_review', 'contained', 'resolved'],
  under_review: ['contained', 'resolved'],
  contained: ['under_review', 'resolved'],
  resolved: [],
  expired: [],
};

const STATUS_LABEL: Record<IncidentStatusDto, string> = {
  open: 'Open',
  under_review: 'Under review',
  contained: 'Contained',
  resolved: 'Resolved',
  expired: 'Expired',
};

/**
 * The score, as the sum it actually is.
 *
 * Every term is shown with its sign, so the arithmetic can be followed and checked. Mitigating
 * evidence sits in the same list rather than in a separate panel — a reader deciding whether to
 * act on somebody needs to see what argued against it in the same glance, not one scroll away.
 */
function Breakdown({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const rows = [...incident.evidence].sort((a, b) => b.weight - a.weight);
  const total = rows.reduce((sum, item) => sum + item.weight, 0);

  return (
    <Card>
      <h2>Why this score</h2>
      <ul className="breakdown">
        {rows.map((item: EvidenceDto) => (
          <li key={`${item.rule}:${item.code}`} className={item.weight < 0 ? 'is-mitigating' : ''}>
            <span className="breakdown__weight">
              {item.weight > 0 ? '+' : ''}
              {item.weight.toFixed(2)}
            </span>
            <span className="breakdown__text">
              <strong>{ruleName(item.rule)}</strong>
              <br />
              {phraseFor(item)}
            </span>
          </li>
        ))}
        <li className="breakdown__total">
          <span className="breakdown__weight">{total.toFixed(2)}</span>
          <span className="breakdown__text">
            <strong>Total</strong>
            <br />
            Clamped to {incident.score.toFixed(2)}
            {incident.band !== 'high' &&
              `, and could be anywhere from ${incident.scoreLower.toFixed(2)} to ${incident.scoreUpper.toFixed(2)}`}
          </span>
        </li>
      </ul>

      {incident.abstentions.length > 0 && (
        <>
          {/* Not the same as a rule that found nothing. A console that showed both as silence
              would invite a reader to treat missing information as evidence of innocence. */}
          <h3>What could not be judged</h3>
          <ul className="abstentions">
            {incident.abstentions.map((abstention) => (
              <li key={abstention.rule}>
                <strong>{ruleName(abstention.rule)}</strong> —{' '}
                {ABSTENTION_REASON[abstention.reason] ?? abstention.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Change({ incident }: { incident: IncidentDetail }): React.JSX.Element | null {
  if (incident.change === null) return null;
  const { ewma, cusum, baseline } = incident.change;
  if (!ewma.fired && !cusum.fired) return null;

  return (
    <Card>
      <h2>Change detection, across the shop</h2>
      {/* Across the shop rather than this entity, which is the level the method is good for: a
          session has no history by construction, so asking whether it changed can only answer
          "it is new". Reported beside the rules rather than folded into the score — "is this
          above a threshold" and "has this changed" are different questions. */}
      <p className="incident__what">
        Normal for this shop was {baseline.mean.toFixed(1)} attempts a minute, learned over{' '}
        {baseline.buckets} minutes. This describes the shop's overall traffic at the time, not this
        entity on its own.
      </p>
      <ul className="abstentions">
        {ewma.fired && (
          <li>
            The weighted average rose {ewma.statistic.toFixed(2)} above normal, past a limit of{' '}
            {ewma.limit.toFixed(2)}.
          </li>
        )}
        {cusum.fired && (
          <li>
            Cumulative deviation reached {cusum.statistic.toFixed(2)} against a limit of{' '}
            {cusum.limit.toFixed(2)}, after {cusum.buckets} minutes of accumulating — a shift too
            small to trip any fixed threshold that did not stop.
          </li>
        )}
      </ul>
    </Card>
  );
}

function Facts({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  return (
    <Card>
      <h2>What happened</h2>
      <dl className="incident__facts">
        <div>
          <dt>First attempt</dt>
          <dd>{new Date(incident.firstAttemptAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>{new Date(incident.detectedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Time to detect</dt>
          <dd>{Math.round(incident.timeToDetectMs / 1000)}s</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{new Date(incident.lastActivityAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{new Date(incident.expiresAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Evaluations</dt>
          <dd>{incident.observations}</dd>
        </div>
      </dl>
      <p className="incident__suggestion">
        <strong>Suggested:</strong> {suggestedAction(incident.severity, incident.firedRules)} — this
        console takes no action of its own.
      </p>
    </Card>
  );
}

function History({
  incident,
  onMove,
  pending,
  error,
}: {
  incident: IncidentDetail;
  onMove: (to: IncidentStatusDto) => void;
  pending: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <Card>
      <h2>History</h2>
      {incident.history.length === 0 ? (
        <p>Nobody has moved this yet.</p>
      ) : (
        <ol className="history">
          {incident.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <strong>
                {STATUS_LABEL[entry.from]} → {STATUS_LABEL[entry.to]}
              </strong>{' '}
              by {entry.actor ?? 'the system'} at {new Date(entry.at).toLocaleString()}
              {entry.note !== null && <> — {entry.note}</>}
            </li>
          ))}
        </ol>
      )}

      {NEXT[incident.status].length > 0 ? (
        <div className="incident-bar">
          {NEXT[incident.status].map((to) => (
            <Button key={to} variant="ghost" onClick={() => onMove(to)} disabled={pending}>
              Mark {STATUS_LABEL[to].toLowerCase()}
            </Button>
          ))}
        </div>
      ) : (
        <p className="incident__band">
          {STATUS_LABEL[incident.status]} is final. An incident that could be reopened is a record
          whose history can be rewritten.
        </p>
      )}

      {error !== null && <p role="alert">{error}</p>}
    </Card>
  );
}

export function IncidentDetailPage(): React.JSX.Element {
  const { id } = useParams({ from: '/console/incidents/$id' });
  const client = useQueryClient();

  const incident = useQuery({ queryKey: ['incident', id], queryFn: () => fetchIncident(id) });

  const move = useMutation({
    mutationFn: async (to: IncidentStatusDto) => {
      const response = await fetch(`/api/incidents/${id}/transition`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ to }),
      });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      return response.json();
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['incident', id] });
      void client.invalidateQueries({ queryKey: ['incidents'] });
    },
  });

  if (incident.isPending) return <p role="status">Loading incident…</p>;

  if (incident.isError) {
    return (
      <Callout tone="critical" title="Could not load this incident">
        <p role="alert">{incident.error.message}</p>
      </Callout>
    );
  }

  const it = incident.data;

  return (
    <>
      <header className="page-head">
        <Link to="/console/incidents">← Incidents</Link>
        <h1>
          {it.entityKind} <code>{it.entityKey.replace(/^v\d+:/, '').slice(0, 16)}</code>
        </h1>
        <p>
          <Badge
            tone={
              it.severity === 'high' ? 'critical' : it.severity === 'medium' ? 'warn' : 'neutral'
            }
          >
            {it.severity}
          </Badge>{' '}
          <Badge tone="neutral">{STATUS_LABEL[it.status]}</Badge>{' '}
          {it.source === 'replay' && <Badge tone="warn">replayed</Badge>}
        </p>
      </header>

      <Facts incident={it} />

      <Breakdown incident={it} />
      <Change incident={it} />
      <ContainmentPanel incidentId={it.id} />

      <History
        incident={it}
        onMove={(to) => move.mutate(to)}
        pending={move.isPending}
        error={move.isError ? move.error.message : null}
      />

      <p className="incident-meta">
        Judged by threshold set <code>{it.thresholdHash}</code>.
      </p>
    </>
  );
}
