import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pulse, Laptop, CreditCard, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ErrorState, Loading, Tabs, type TabItem } from '@sentinel/ui';
import {
  incidentDetailResponseSchema,
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
import { formatWindow, timeAgo } from '../shared/time.js';

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
const BAND_LABEL: Record<string, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
};
const HYPOTHESIS_LABEL: Record<IncidentDetail['primaryHypothesis'], string> = {
  attack: 'Coordinated abuse pattern',
  outage: 'Gateway or service outage',
  retry_storm: 'Aggressive retry pattern',
  healthy_traffic: 'Healthy traffic pattern',
  insufficient_evidence: 'Insufficient evidence',
};
const incidentRef = (id: string): string => `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'oklch(0.3 0.015 280)' }}>
        Sentinel recommends:{' '}
        <strong style={{ fontWeight: 700, color: 'oklch(0.35 0.16 250)' }}>
          {rec.actionLabel}
        </strong>
      </span>
      <p
        style={{
          margin: 0,
          maxWidth: '96ch',
          fontSize: '12.5px',
          fontWeight: 500,
          lineHeight: 1.65,
          color: 'oklch(0.48 0.015 280)',
          textWrap: 'pretty',
        }}
      >
        {rec.rationale}
      </p>
      {rec.alignment === 'diverges' && (
        <p style={{ margin: 0, fontSize: '12px', fontWeight: 500, color: 'oklch(0.48 0.15 22)' }}>
          {rec.alignmentNote}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 15px',
            border: '1px solid oklch(0.93 0.006 280)',
            borderRadius: '8px',
            fontFamily: 'inherit',
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'oklch(0.24 0.015 280)',
            background: 'oklch(1 0 0)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {rec.actionLabel} →
        </button>
      </div>
      {disabled && (
        <p style={{ margin: 0, fontSize: '12px', fontWeight: 500, color: 'oklch(0.58 0.015 280)' }}>
          {terminal ? 'This incident is closed.' : 'A containment is already proposed.'}
        </p>
      )}
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'oklch(0.58 0.015 280)' }}>
        This is only a recommendation. Nothing happens until you approve it.
      </span>
      {(rec.degraded || rec.rehearsal) && (
        <p
          style={{ margin: 0, fontSize: '11.5px', fontWeight: 500, color: 'oklch(0.6 0.015 280)' }}
        >
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '18px 20px',
        borderBottom: '1px solid oklch(0.955 0.006 280)',
        background: 'oklch(0.988 0.002 270)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <OvSparkle />
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          What the AI model weighed
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'oklch(0.3 0.015 280)' }}>
        {modelRaised ? (
          <>
            The model raised this <strong style={{ fontWeight: 700 }}>on its own</strong> — no
            single rule fired. It reads the activity as{' '}
            <strong style={{ fontWeight: 700 }}>{pct}% likely card testing</strong>, driven by:
          </>
        ) : (
          <>
            The model reads this as{' '}
            <strong style={{ fontWeight: 700 }}>{pct}% likely card testing</strong>, driven by:
          </>
        )}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {top.map((c) => {
          const positive = c.contribution >= 0;
          const width = Math.round((Math.abs(c.contribution) / maxAbs) * 100);
          return (
            <div
              key={c.feature}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 168px) minmax(0, 1fr) 52px',
                gap: '14px',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'oklch(0.34 0.015 280)' }}>
                {featureLabel(c.feature)}
              </span>
              <span
                style={{
                  position: 'relative',
                  height: '6px',
                  borderRadius: '99px',
                  background: 'oklch(0.95 0.006 280)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${width}%`,
                    background: positive ? 'oklch(0.62 0.17 22)' : 'oklch(0.62 0.12 162)',
                    borderRadius: '99px',
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  color: positive ? 'oklch(0.48 0.15 22)' : 'oklch(0.4 0.11 162)',
                }}
              >
                {positive ? '+' : ''}
                {c.contribution.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'oklch(0.62 0.015 280)' }}>
        Exact contributions from the served model — {opinion.modelVersion}. Not an approximation.
      </span>
    </div>
  );
}

function OverviewKpiStrip({ it }: { it: IncidentDetail }): React.JSX.Element {
  const capturedPaise = it.relatedOrders
    .flatMap((o) => o.attempts)
    .filter((a) => a.status === 'captured')
    .reduce((sum, a) => sum + (a.amountPaise ?? 0), 0);
  const cards = it.distinctCards ?? (it.graph.cards.length > 0 ? it.graph.cards.length : null);
  const span = formatWindow(it.lastActivityAt - it.firstAttemptAt);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        borderBottom: '1px solid oklch(0.955 0.006 280)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '14px 20px' }}>
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Payment attempts
        </span>
        <span
          style={{
            fontSize: '24px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.21 0.015 280)',
          }}
        >
          {it.attempts}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '14px 20px',
          borderLeft: '1px solid oklch(0.968 0.006 280)',
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Distinct cards
        </span>
        <span
          style={{
            fontSize: '24px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.21 0.015 280)',
          }}
        >
          {cards !== null ? cards : '—'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '14px 20px',
          borderLeft: '1px solid oklch(0.968 0.006 280)',
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Failures
        </span>
        <span
          style={{
            fontSize: '24px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.48 0.15 22)',
          }}
        >
          {it.failures}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '14px 20px',
          borderLeft: '1px solid oklch(0.968 0.006 280)',
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Captured amount
        </span>
        <span
          style={{
            fontSize: '24px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.21 0.015 280)',
          }}
        >
          {rupees(capturedPaise)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '14px 20px',
          borderLeft: '1px solid oklch(0.968 0.006 280)',
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Time window
        </span>
        <span
          style={{
            fontSize: '20px',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.21 0.015 280)',
          }}
        >
          {span}
        </span>
      </div>
    </div>
  );
}

function WhyFlaggedSection({
  it,
  rec,
  pending,
}: {
  it: IncidentDetail;
  rec: RiskRecommendation | null;
  pending: boolean;
}): React.JSX.Element {
  const reasons =
    rec !== null
      ? rec.keyReasons.map((c) => c.text)
      : [...it.evidence]
          .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
          .slice(0, 5)
          .map(phraseFor);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '18px 20px',
        borderBottom: '1px solid oklch(0.955 0.006 280)',
      }}
    >
      <span
        style={{
          fontSize: '10.5px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'oklch(0.56 0.015 280)',
        }}
      >
        Why this was flagged
      </span>
      {pending ? (
        <p className="ad-muted">Analysing…</p>
      ) : (
        reasons.map((r, i) => {
          const lower = r.toLowerCase();
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {lower.includes('card') ? (
                <CreditCard size={16} color="oklch(0.58 0.015 280)" />
              ) : lower.includes('failed') || lower.includes('failure') ? (
                <WarningCircle size={16} color="oklch(0.58 0.015 280)" />
              ) : (
                <Laptop size={16} color="oklch(0.58 0.015 280)" />
              )}
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'oklch(0.28 0.015 280)' }}>
                {r}
              </span>
            </div>
          );
        })
      )}
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

  return (
    <div className="ov">
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          background: 'oklch(1 0 0)',
          border: '1px solid oklch(0.925 0.006 280)',
          overflow: 'hidden',
          marginBottom: '14px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid oklch(0.955 0.006 280)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 32px',
              width: '32px',
              height: '32px',
              borderRadius: '99px',
              background: 'oklch(0.962 0.024 258)',
            }}
          >
            <Pulse size={16} color="oklch(0.46 0.12 258)" />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: '14.5px',
                fontWeight: 600,
                letterSpacing: '-0.018em',
                color: 'oklch(0.21 0.015 280)',
              }}
            >
              Incident overview &amp; recommendation
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
                textWrap: 'pretty',
              }}
            >
              What was detected, and what Sentinel suggests.
            </p>
          </div>
        </div>

        <OverviewKpiStrip it={it} />

        <WhyFlaggedSection it={it} rec={rec} pending={recommendation.isPending} />

        {it.modelOpinion !== null && (
          <ModelReasoning opinion={it.modelOpinion} modelRaised={it.evidence.length === 0} />
        )}

        <div style={{ padding: '18px 20px' }}>
          <BriefActionSection
            rec={rec}
            loading={recommendation.isPending}
            error={recommendation.isError}
            terminal={terminal}
            hasLive={live !== undefined}
            onAction={() => setModalOpen(true)}
          />
        </div>
      </section>

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
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
        marginBottom: '14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '28px',
          flexWrap: 'wrap',
          padding: '20px 24px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            {it.entityKind} incident · {incidentRef(it.id)}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '25px',
                fontWeight: 700,
                letterSpacing: '-0.038em',
                color: 'oklch(0.19 0.015 280)',
              }}
            >
              {it.title}
            </h1>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color:
                  it.severity === 'high'
                    ? 'oklch(0.48 0.15 22)'
                    : it.severity === 'medium'
                      ? 'oklch(0.45 0.12 70)'
                      : 'oklch(0.44 0.015 280)',
                background:
                  it.severity === 'high'
                    ? 'oklch(0.958 0.026 22)'
                    : it.severity === 'medium'
                      ? 'oklch(0.965 0.03 70)'
                      : 'oklch(0.958 0.006 280)',
              }}
            >
              {it.severity} severity
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color:
                  it.status === 'resolved'
                    ? 'oklch(0.4 0.11 162)'
                    : it.status === 'open'
                      ? 'oklch(0.46 0.13 22)'
                      : 'oklch(0.45 0.12 70)',
                background:
                  it.status === 'resolved'
                    ? 'oklch(0.955 0.03 162)'
                    : it.status === 'open'
                      ? 'oklch(0.958 0.026 22)'
                      : 'oklch(0.965 0.03 70)',
              }}
            >
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '99px',
                  background:
                    it.status === 'resolved'
                      ? 'oklch(0.6 0.13 162)'
                      : it.status === 'open'
                        ? 'oklch(0.62 0.17 22)'
                        : 'oklch(0.68 0.14 70)',
                }}
              />
              {STATUS_LABEL[it.status]}
            </span>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'oklch(0.44 0.015 280)',
                background: 'oklch(0.958 0.006 280)',
              }}
            >
              {it.source === 'replay' ? 'Simulation' : 'Live'}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 500,
              color: 'oklch(0.5 0.015 280)',
            }}
          >
            {reasonLine(it)}
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
              fontSize: '12.5px',
              fontWeight: 500,
              color: 'oklch(0.5 0.015 280)',
            }}
          >
            <span>
              Detected{' '}
              <strong style={{ fontWeight: 700, color: 'oklch(0.26 0.015 280)' }}>
                {timeAgo(it.detectedAt)}
              </strong>
            </span>
            <span
              style={{
                width: '3px',
                height: '3px',
                borderRadius: '99px',
                background: 'oklch(0.82 0.01 280)',
              }}
            />
            <span>
              Last activity{' '}
              <strong style={{ fontWeight: 700, color: 'oklch(0.26 0.015 280)' }}>
                {timeAgo(it.lastActivityAt)}
              </strong>
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ position: 'relative', flex: '0 0 128px', width: '128px' }}>
            <RiskGauge
              score={it.score}
              level={it.band}
              size="sm"
              hideBox={true}
              hideReadout={true}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
              <span
                style={{
                  fontSize: '30px',
                  fontWeight: 700,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'oklch(0.19 0.015 280)',
                }}
              >
                {Math.round(it.score * 100)}
              </span>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'oklch(0.62 0.015 280)' }}>
                /100
              </span>
            </div>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              Risk score
            </span>
            <span
              style={{
                padding: '3px 10px',
                width: 'fit-content',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color:
                  it.band === 'high'
                    ? 'oklch(0.48 0.15 22)'
                    : it.band === 'medium'
                      ? 'oklch(0.45 0.12 70)'
                      : 'oklch(0.44 0.015 280)',
                background:
                  it.band === 'high'
                    ? 'oklch(0.958 0.026 22)'
                    : it.band === 'medium'
                      ? 'oklch(0.965 0.03 70)'
                      : 'oklch(0.958 0.006 280)',
              }}
            >
              {BAND_LABEL[it.band] ?? `${it.band} risk`}
            </span>
          </div>
        </div>
      </div>
    </section>
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
