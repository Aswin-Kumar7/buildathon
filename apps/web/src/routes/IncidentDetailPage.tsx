import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pulse, WarningCircle, Shield } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Badge, Card, ErrorState, Loading, StatusDot, Tabs, type TabItem } from '@sentinel/ui';
import {
  incidentDetailResponseSchema,
  type EvidenceDto,
  type IncidentDetail,
  type IncidentStatusDto,
  type RiskRecommendation,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { phraseFor } from '../incidents/evidence.js';
import {
  ActionsAuditTab,
  TERMINAL,
  PendingApproval,
  useActionsData,
  useActionMutations,
} from './IncidentActionsAudit.js';
import { TakeActionModal } from './ActionsAiCard.js';
import { IncidentTimelineTab } from './IncidentTimelineTab.js';
import { ModelAssessmentTab, featureLabel } from './IncidentModelAssessment.js';
import { EvidenceSignalsTab } from './IncidentEvidence.js';
import { RelationshipsTab } from './IncidentRelationships.js';
import { IncidentAttemptsTab } from './IncidentAttempts.js';
import { IncidentCopilotWidget } from './IncidentCopilot.js';
import { RiskGauge } from '../components/RiskGauge.js';
import './IncidentsPage.css';
import './IncidentDetailPage.css';

type Verdict = 'confirmed_abuse' | 'false_positive';
type TabId =
  'overview' | 'evidence' | 'relationships' | 'attempts' | 'model' | 'actions' | 'timeline';

async function fetchIncident(id: string): Promise<IncidentDetail> {
  const response = await fetch(`/api/incidents/${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentDetailResponseSchema.parse(await response.json()).incident;
}

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
const BAND_LABEL: Record<string, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
};
const MODEL_BAND_LABEL: Record<string, string> = {
  observe: 'Keep watching',
  review: 'Send for review',
  contain_eligible: 'Blocking is an option',
};
const HYPOTHESIS_LABEL: Record<IncidentDetail['primaryHypothesis'], string> = {
  attack: 'Coordinated abuse pattern',
  outage: 'Gateway or service outage',
  retry_storm: 'Aggressive retry pattern',
  healthy_traffic: 'Healthy traffic pattern',
  insufficient_evidence: 'Insufficient evidence',
};
const INFLUENCE_LABEL: Record<string, string> = {
  none: 'No change to the rules',
  corroborated: 'Corroborated the rules',
  escalated: 'Escalated the case',
  deescalated: 'De-escalated the case',
  flagged: 'Flagged on its own',
};

const incidentRef = (id: string): string => `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function formatWindow(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (minutes < 60) return `${minutes} min ${seconds} sec`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

const clockTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

type Move = { to: IncidentStatusDto; verdict?: Verdict };

function reasonLine(it: IncidentDetail): string {
  const top = [...it.evidence].filter((e) => e.weight > 0).sort((a, b) => b.weight - a.weight)[0];
  return top !== undefined ? phraseFor(top) : HYPOTHESIS_LABEL[it.primaryHypothesis];
}

function OvSparkle(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.6L19.5 9l-4.6 3.3L16.4 18 12 14.7 7.6 18l1.5-5.7L4.5 9l5.6-1.4z" />
    </svg>
  );
}

const rupees = (paise: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="ad-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CardHeaderTitle({
  icon,
  text,
  badgeTone,
}: {
  icon: React.ReactNode;
  text: string;
  badgeTone: string;
}): React.JSX.Element {
  return (
    <div className="ad-card-head-inner">
      <span className={`ad-card-badge ad-card-badge--${badgeTone}`}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function BriefActionSection({
  rec,
  loading,
  error,
  terminal,
  hasLive,
  onAction,
}: {
  rec: RiskRecommendation | null;
  loading: boolean;
  error: boolean;
  terminal: boolean;
  hasLive: boolean;
  onAction: () => void;
}): React.JSX.Element {
  if (loading) return <p className="ad-muted">Loading recommendation…</p>;
  if (error || rec === null) {
    return (
      <p className="ad-muted">
        {error ? 'Could not load recommendation.' : 'No recommendation available.'}
      </p>
    );
  }
  const disabled = terminal || (rec.action === 'contain' && hasLive);
  return (
    <div>
      <h3
        className="ov-brief__heading"
        style={{
          fontSize: '0.88rem',
          color: '#0f172a',
          textTransform: 'none',
          margin: '0 0 0.4rem',
        }}
      >
        Sentinel recommends: <strong style={{ color: '#0b72e7' }}>{rec.actionLabel}</strong>
      </h3>
      <p className="ov-brief__text">{rec.rationale}</p>
      {rec.alignment === 'diverges' && <p className="ov-brief__warn">{rec.alignmentNote}</p>}
      <button
        type="button"
        className={`ov-brief__btn ov-brief__btn--${rec.action}`}
        onClick={onAction}
        disabled={disabled}
      >
        {rec.actionLabel} →
      </button>
      {disabled && (
        <p className="ov-brief__muted" style={{ marginTop: '0.5rem' }}>
          {terminal ? 'This incident is closed.' : 'A containment is already proposed.'}
        </p>
      )}
      <p className="ov-brief__foot">
        This is only a recommendation. Nothing happens until you approve it.
      </p>
      {(rec.degraded || rec.rehearsal) && (
        <p className="ov-brief__note">
          {rec.degraded && 'Built automatically — the live AI was unavailable. '}
          {rec.rehearsal && 'Simulation — an executed action would block nobody.'}
        </p>
      )}
    </div>
  );
}

/**
 * The learned model's own reasoning, at the point of decision instead of a tab away.
 *
 * The contributions are exact for the served linear model (coefficient × standardised value), so this
 * is the real breakdown behind P(abuse), not an after-the-fact rationalisation. When the rules opened
 * nothing (no evidence) the model is what raised the case, and the copy says so — the one place the
 * "AI Risk Manager" visibly out-reasons a burst rule.
 */
function ModelReasoning({
  opinion,
  modelRaised,
}: {
  opinion: NonNullable<IncidentDetail['modelOpinion']>;
  modelRaised: boolean;
}): React.JSX.Element {
  const top = [...opinion.contributions]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4);
  const maxAbs = Math.max(1e-6, ...top.map((c) => Math.abs(c.contribution)));
  const pct = Math.round(opinion.risk * 100);

  return (
    <div className="ov-mr">
      <h4 className="ov-mr__head">
        <OvSparkle /> What the AI model weighed
      </h4>
      <p className="ov-mr__lead">
        {modelRaised ? (
          <>
            The model raised this <strong>on its own</strong> — no single rule fired. It reads the
            activity as <strong>{pct}% likely card testing</strong>, driven by:
          </>
        ) : (
          <>
            The model reads this as <strong>{pct}% likely card testing</strong>, driven by:
          </>
        )}
      </p>
      <ul className="ov-mr__bars">
        {top.map((c) => {
          const positive = c.contribution >= 0;
          const width = Math.round((Math.abs(c.contribution) / maxAbs) * 100);
          return (
            <li key={c.feature} className="ov-mr__row">
              <span className="ov-mr__feat">{featureLabel(c.feature)}</span>
              <span className="ov-mr__track">
                <span
                  className={`ov-mr__fill ov-mr__fill--${positive ? 'up' : 'down'}`}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className={`ov-mr__val ov-mr__val--${positive ? 'up' : 'down'}`}>
                {positive ? '+' : ''}
                {c.contribution.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="ov-mr__foot">
        Exact contributions from the served model — {opinion.modelVersion}. Not an approximation.
      </p>
    </div>
  );
}

function OverviewTab({ it }: { it: IncidentDetail }): React.JSX.Element {
  const client = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const { recommendation, containments } = useActionsData(it.id);
  const { accept, approve, reject } = useActionMutations(it.id, client, () => setModalOpen(false));
  const rec = recommendation.data ?? null;
  const live = (containments.data ?? []).find(
    (c) => c.status === 'proposed' || c.status === 'active',
  );
  const terminal = TERMINAL.has(it.status);

  const capturedPaise = it.relatedOrders
    .flatMap((o) => o.attempts)
    .filter((a) => a.status === 'captured')
    .reduce((sum, a) => sum + (a.amountPaise ?? 0), 0);
  const cards = it.distinctCards ?? (it.graph.cards.length > 0 ? it.graph.cards.length : null);
  const span = formatWindow(it.lastActivityAt - it.firstAttemptAt);

  const reasons =
    rec !== null
      ? rec.keyReasons.map((c) => c.text)
      : [...it.evidence]
          .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
          .slice(0, 5)
          .map(phraseFor);

  return (
    <div className="ov">
      <Card
        title={
          <CardHeaderTitle
            icon={<Pulse />}
            text="Incident Overview & Recommendation"
            badgeTone="blue"
          />
        }
      >
        <div className="ov-kpi-strip">
          <div className="ov-kpi-item">
            <span className="ov-kpi-label">Payment attempts</span>
            <strong className="ov-kpi-val">{it.attempts}</strong>
          </div>
          <div className="ov-kpi-item">
            <span className="ov-kpi-label">Distinct cards</span>
            <strong className="ov-kpi-val">{cards !== null ? cards : '—'}</strong>
          </div>
          <div className="ov-kpi-item">
            <span className="ov-kpi-label">Failures</span>
            <strong className="ov-kpi-val ov-kpi-val--warn">{it.failures}</strong>
          </div>
          <div className="ov-kpi-item">
            <span className="ov-kpi-label">Captured amount</span>
            <strong
              className={`ov-kpi-val ${capturedPaise > 0 ? 'ov-kpi-val--bad' : 'ov-kpi-val--ok'}`}
            >
              {rupees(capturedPaise)}
            </strong>
          </div>
          <div className="ov-kpi-item">
            <span className="ov-kpi-label">Time window</span>
            <strong className="ov-kpi-val" style={{ fontSize: '1.1rem' }}>
              {span}
            </strong>
          </div>
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          <h4
            style={{
              margin: '0 0 0.5rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#64748b',
            }}
          >
            Why this was flagged
          </h4>
          {recommendation.isPending ? (
            <p className="ad-muted">Analysing…</p>
          ) : (
            <ul className="ov-brief__reasons">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>

        {it.modelOpinion !== null && (
          <div style={{ marginTop: '1.25rem' }}>
            <ModelReasoning opinion={it.modelOpinion} modelRaised={it.evidence.length === 0} />
          </div>
        )}

        <div
          style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #f1f5f9' }}
        >
          <BriefActionSection
            rec={rec}
            loading={recommendation.isPending}
            error={recommendation.isError}
            terminal={terminal}
            hasLive={live !== undefined}
            onAction={() => setModalOpen(true)}
          />
        </div>
      </Card>

      <PendingApproval
        containment={live?.status === 'proposed' ? live : undefined}
        approve={approve}
        reject={reject}
      />
      {modalOpen && rec !== null && (
        <TakeActionModal
          recommendation={rec}
          hasLiveContainment={live !== undefined}
          pending={accept.isPending}
          error={accept.isError ? accept.error.message : null}
          onConfirm={() => accept.mutate(rec.groundingHash)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

export function IncidentDetailPage(): React.JSX.Element {
  const { id } = useParams({ from: '/console/incidents/$id' });
  const client = useQueryClient();

  const [tab, setTab] = useState<TabId>('overview');
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
      <IncidentHeader it={it} />
      <IncidentBody
        it={it}
        tab={tab}
        setTab={setTab}
        onMove={(m) => move.mutate(m)}
        movePending={move.isPending}
        moveError={move.isError ? move.error.message : null}
      />
      <IncidentCopilotWidget incident={it} />
    </div>
  );
}

function IncidentHeader({ it }: { it: IncidentDetail }): React.JSX.Element {
  return (
    <header className="ov-head">
      <div className="ov-head__text">
        <span className="ov-head__eyebrow">
          {it.entityKind} incident · {incidentRef(it.id)}
        </span>
        <div className="ov-head__title">
          <h1>{it.title}</h1>
          <Badge tone={SEVERITY_TONE[it.severity]}>{it.severity} severity</Badge>
          <StatusDot tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</StatusDot>
          <Badge tone={it.source === 'replay' ? 'neutral' : 'info'}>
            {it.source === 'replay' ? 'Simulation' : 'Live'}
          </Badge>
        </div>
        <p className="ov-head__reason">{reasonLine(it)}</p>
        <p className="ov-head__meta">
          <span>
            Detected{' '}
            <strong title={new Date(it.detectedAt).toLocaleString()}>
              {timeAgo(it.detectedAt)}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Last activity{' '}
            <strong title={new Date(it.lastActivityAt).toLocaleString()}>
              {timeAgo(it.lastActivityAt)}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Risk Score{' '}
            <strong style={{ color: '#0b72e7' }}>{Math.round(it.score * 100)}/100</strong> (
            {BAND_LABEL[it.band] ?? `${it.band} band`})
          </span>
        </p>
      </div>
      <div className="ov-head__gauge">
        <RiskGauge score={it.score} level={it.band} size="sm" hideBox={true} />
      </div>
    </header>
  );
}

function IncidentBody({
  it,
  tab,
  setTab,
  onMove,
  movePending,
  moveError,
}: {
  it: IncidentDetail;
  tab: TabId;
  setTab: (tab: TabId) => void;
  onMove: (move: Move) => void;
  movePending: boolean;
  moveError: string | null;
}): React.JSX.Element {
  const attemptCount = it.relatedOrders.reduce((sum, order) => sum + order.attempts.length, 0);
  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'evidence', label: 'Evidence & signals' },
    { id: 'relationships', label: 'Relationships' },
    { id: 'attempts', label: `Attempts (${attemptCount})` },
    { id: 'model', label: 'Model assessment' },
    { id: 'actions', label: 'Actions & audit' },
    { id: 'timeline', label: 'Timeline' },
  ];
  return (
    <>
      <Tabs
        items={tabs}
        active={tab}
        onChange={(value) => setTab(value as TabId)}
        className="ov-tabs"
      />

      {tab === 'overview' && <OverviewTab it={it} />}

      {tab === 'evidence' && <EvidenceSignalsTab it={it} />}

      {tab === 'relationships' && <RelationshipsTab it={it} />}

      {tab === 'attempts' && <IncidentAttemptsTab incident={it} />}

      {tab === 'model' && (
        <ModelAssessmentTab incident={it} onViewEvidence={() => setTab('evidence')} />
      )}

      {tab === 'actions' && (
        <ActionsAuditTab
          incident={it}
          onResolve={(verdict) => onMove({ to: 'resolved', verdict })}
          resolvePending={movePending}
          resolveError={moveError}
        />
      )}

      {tab === 'timeline' && <IncidentTimelineTab incident={it} />}
    </>
  );
}
