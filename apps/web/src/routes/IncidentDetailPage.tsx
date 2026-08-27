import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge, Button, Card, ErrorState, Loading, StatusDot } from '@sentinel/ui';
import {
  incidentDetailResponseSchema,
  type EvidenceDto,
  type IncidentDetail,
  type IncidentStatusDto,
  type ResolvedOrder,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { ABSTENTION_REASON, phraseFor, ruleName } from '../incidents/evidence.js';
import { ContainmentPanel } from '../incidents/ContainmentPanel.js';
import { AuditTrail } from '../incidents/AuditTrail.js';
import { ModelOpinion } from '../incidents/ModelOpinion.js';
import { NarrativePanel } from '../incidents/NarrativePanel.js';
import './IncidentsPage.css';
import './IncidentDetailPage.css';

type Verdict = 'confirmed_abuse' | 'false_positive';

async function fetchIncident(id: string): Promise<IncidentDetail> {
  const response = await fetch(`/api/incidents/${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentDetailResponseSchema.parse(await response.json()).incident;
}

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
const STATUS_TONE: Record<IncidentStatusDto, 'critical' | 'warn' | 'ok' | 'neutral'> = {
  open: 'critical',
  under_review: 'warn',
  contained: 'ok',
  resolved: 'neutral',
  expired: 'neutral',
};
const SEVERITY_TONE = { high: 'critical', medium: 'warn', low: 'neutral' } as const;
const HYPOTHESIS_LABEL: Record<IncidentDetail['primaryHypothesis'], string> = {
  attack: 'Coordinated abuse pattern',
  outage: 'Gateway or service outage',
  retry_storm: 'Aggressive retry pattern',
  healthy_traffic: 'Healthy traffic pattern',
  insufficient_evidence: 'Insufficient evidence',
};
const DECISION_LABEL: Record<IncidentDetail['recommendedDecision'], string> = {
  none: 'No intervention',
  contain: 'Contain eligible activity',
  review: 'Send for analyst review',
  monitor: 'Monitor activity',
};

type Move = { to: IncidentStatusDto; verdict?: Verdict };

function Breakdown({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const rows = [...incident.evidence].sort((a, b) => b.weight - a.weight);
  const total = rows.reduce((sum, item) => sum + item.weight, 0);

  return (
    <Card title="Why this score" subtitle="Every term signed, so the arithmetic can be checked.">
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
    <Card title="Change across the shop">
      <p className="detail-note">
        Normal for this shop was {baseline.mean.toFixed(1)} attempts a minute, learned over{' '}
        {baseline.buckets} minutes — the shop’s overall traffic, not this entity alone.
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
            {cusum.limit.toFixed(2)}, after {cusum.buckets} minutes — a shift too small to trip a
            fixed threshold.
          </li>
        )}
      </ul>
    </Card>
  );
}

function Summary({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const rows: [string, string][] = [
    ['First attempt', new Date(incident.firstAttemptAt).toLocaleString()],
    ['Detected', new Date(incident.detectedAt).toLocaleString()],
    ['Time to detect', `${Math.round(incident.timeToDetectMs / 1000)}s`],
    ['Last activity', new Date(incident.lastActivityAt).toLocaleString()],
    ['Expires', new Date(incident.expiresAt).toLocaleString()],
    ['Evaluations', String(incident.observations)],
  ];
  return (
    <Card title="Summary">
      <dl className="detail-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function DecisionRail({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const needsApproval = incident.recommendedDecision === 'contain';
  return (
    <Card
      title="Decision summary"
      subtitle="Detection, recommendation, action and status are separate records."
    >
      <div className="decision-rail">
        <div>
          <span>Detection</span>
          <strong>{HYPOTHESIS_LABEL[incident.primaryHypothesis]}</strong>
          <small>Evidence-backed risk type · {incident.score.toFixed(2)} score</small>
        </div>
        <div>
          <span>Recommendation</span>
          <strong>{DECISION_LABEL[incident.recommendedDecision]}</strong>
          <small>Produced under threshold set {incident.thresholdHash.slice(0, 8)}</small>
        </div>
        <div>
          <span>Action</span>
          <strong>{needsApproval ? 'Approval required' : 'No customer-impacting action'}</strong>
          <small>
            {needsApproval
              ? 'Use the Action panel to propose and approve containment.'
              : 'The engine is observing or escalating only.'}
          </small>
        </div>
        <div>
          <span>Status</span>
          <strong>{STATUS_LABEL[incident.status]}</strong>
          <small>Every transition is recorded in the audit trail.</small>
        </div>
      </div>
    </Card>
  );
}

const rupees = (paise: number | null): string =>
  paise === null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

function RelatedAttempts({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const attempts = incident.relatedOrders.flatMap((order) =>
    order.attempts.map((attempt) => ({ order, attempt })),
  );

  return (
    <Card
      title="Related payment attempts"
      subtitle="Orders linked through this incident's session, device or network fingerprint."
    >
      {attempts.length === 0 ? (
        <p className="detail-note">
          No canonical payment attempts are linked yet. The checkout context may have arrived before
          its Razorpay webhook, or this incident may be based on pre-payment activity.
        </p>
      ) : (
        <div className="detail-attempts">
          <a
            className="detail-attempts__link"
            href={`/console/attempts?entityKind=${incident.entityKind}&entityKey=${encodeURIComponent(incident.entityKey)}&source=${incident.source}`}
          >
            Open all related attempts →
          </a>
          {incident.relatedOrders.map((order: ResolvedOrder) => (
            <div className="detail-attempt" key={order.razorpayOrderId}>
              <div>
                <strong>{order.razorpayOrderId}</strong>
                <span>{rupees(order.amountPaise)}</span>
              </div>
              <div className="detail-attempt__meta">
                {order.attempts.length} attempt{order.attempts.length === 1 ? '' : 's'} ·{' '}
                {order.failureCount} failed · {order.outcome}
                {order.recovered ? ' · recovered' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Actions({
  status,
  onMove,
  pending,
}: {
  status: IncidentStatusDto;
  onMove: (move: Move) => void;
  pending: boolean;
}): React.JSX.Element {
  const next = NEXT[status];
  if (next.length === 0) {
    return (
      <p className="detail-note">
        {STATUS_LABEL[status]} is final — an incident that could be reopened is a record whose
        history can be rewritten.
      </p>
    );
  }
  return (
    <div className="detail-actions">
      {next.includes('under_review') && (
        <Button
          variant="secondary"
          block
          onClick={() => onMove({ to: 'under_review' })}
          disabled={pending}
        >
          Move to review
        </Button>
      )}
      {next.includes('contained') && (
        <Button
          variant="danger"
          block
          onClick={() => onMove({ to: 'contained' })}
          disabled={pending}
        >
          Contain — confirmed abuse
        </Button>
      )}
      {next.includes('resolved') && (
        <>
          <Button
            variant="secondary"
            block
            onClick={() => onMove({ to: 'resolved', verdict: 'confirmed_abuse' })}
            disabled={pending}
          >
            Resolve — confirmed abuse
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => onMove({ to: 'resolved', verdict: 'false_positive' })}
            disabled={pending}
          >
            Resolve — false positive
          </Button>
        </>
      )}
    </div>
  );
}

function Resolution({
  incident,
  onMove,
  pending,
  error,
}: {
  incident: IncidentDetail;
  onMove: (move: Move) => void;
  pending: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <Card title="Resolution" subtitle="What you decide here becomes a label the model retrains on.">
      {incident.label !== null && (
        <p className="detail-label">
          Confirmed as{' '}
          <Badge tone={incident.label === 1 ? 'critical' : 'ok'}>
            {incident.label === 1 ? 'abuse' : 'false positive'}
          </Badge>{' '}
          <span className="detail-note">({incident.labelSource ?? 'analyst'})</span>
        </p>
      )}

      <Actions status={incident.status} onMove={onMove} pending={pending} />

      {error !== null && (
        <p className="detail-note" role="alert" style={{ color: 'var(--s-critical-ink)' }}>
          {error}
        </p>
      )}

      {incident.history.length > 0 && (
        <>
          <h3>History</h3>
          <ol className="history">
            {incident.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <strong>
                  {STATUS_LABEL[entry.from]} → {STATUS_LABEL[entry.to]}
                </strong>{' '}
                · {entry.actor ?? 'system'} · {new Date(entry.at).toLocaleString()}
                {entry.note !== null && <> — {entry.note}</>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

export function IncidentDetailPage(): React.JSX.Element {
  const { id } = useParams({ from: '/console/incidents/$id' });
  const client = useQueryClient();

  const incident = useQuery({ queryKey: ['incident', id], queryFn: () => fetchIncident(id) });

  const move = useMutation({
    mutationFn: async ({ to, verdict }: Move) => {
      const response = await fetch(`/api/incidents/${id}/transition`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ to, ...(verdict !== undefined && { verdict }) }),
      });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      return response.json();
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['incident', id] });
      void client.invalidateQueries({ queryKey: ['incidents'] });
    },
  });

  if (incident.isPending) return <Loading label="Loading incident…" />;
  if (incident.isError) {
    return <ErrorState title="Could not load this incident" message={incident.error.message} />;
  }

  const it = incident.data;

  return (
    <div className="detail">
      <Link to="/console/incidents" className="detail-back">
        ← Back to incidents
      </Link>

      <header className="detail-head">
        <div className="detail-head__text">
          <span className="detail-eyebrow">{it.entityKind} incident</span>
          <h1>
            <code>{it.entityKey.replace(/^v\d+:/, '').slice(0, 22)}</code>
          </h1>
          <div className="detail-badges">
            <Badge tone={SEVERITY_TONE[it.severity]}>{it.severity} severity</Badge>
            <StatusDot tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</StatusDot>
            <Badge tone={it.source === 'replay' ? 'neutral' : 'info'}>
              {it.source === 'replay' ? 'replayed' : 'live'}
            </Badge>
          </div>
        </div>
        <div className="detail-score">
          <span className="detail-score__label">Risk score</span>
          <span className="detail-score__value">{it.score.toFixed(2)}</span>
        </div>
      </header>

      <DecisionRail incident={it} />

      <div className="detail-grid">
        <div className="detail-main">
          <NarrativePanel incidentId={it.id} />
          <Breakdown incident={it} />
          <Change incident={it} />
          <ModelOpinion incident={it} />
          <RelatedAttempts incident={it} />
          <ContainmentPanel incidentId={it.id} />
          <AuditTrail incidentId={it.id} />
        </div>

        <aside className="detail-side">
          <Resolution
            incident={it}
            onMove={(m) => move.mutate(m)}
            pending={move.isPending}
            error={move.isError ? move.error.message : null}
          />
          <Summary incident={it} />
          <p className="detail-thresh">
            Judged by threshold set <code>{it.thresholdHash}</code>.
          </p>
        </aside>
      </div>
    </div>
  );
}
