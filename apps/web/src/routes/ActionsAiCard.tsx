import { Card } from '@sentinel/ui';
import { Lightning } from '@phosphor-icons/react';
import type { RiskAction, RiskRecommendation } from '@sentinel/contracts';
import type { QueryState } from './IncidentActionsAudit.js';

const SOURCE_LABEL: Record<RiskRecommendation['source'], string> = {
  live: 'Live model',
  local: 'Local model',
  replay: 'Replay',
  template: 'Template',
};

const ACTION_TONE: Record<RiskAction, string> = {
  contain: 'critical',
  review: 'warn',
  monitor: 'neutral',
};

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

const box = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true,
} as const;
const Sparkle = (): React.JSX.Element => (
  <svg {...box}>
    <path
      d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5 10.1 7.6z"
      fill="currentColor"
    />
  </svg>
);
const Shield = (): React.JSX.Element => (
  <svg {...box}>
    <path
      d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </svg>
);
const Eye = (): React.JSX.Element => (
  <svg {...box}>
    <path
      d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
const Reasons = (): React.JSX.Element => (
  <svg {...box}>
    <path
      d="M4 6h16M4 12h16M4 18h10"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);
const Arrow = (): React.JSX.Element => (
  <svg {...box}>
    <path
      d="M5 12h14M13 6l6 6-6 6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const Lock = (): React.JSX.Element => (
  <svg {...box}>
    <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
const actionIcon = (action: RiskAction): React.JSX.Element =>
  action === 'contain' ? <Shield /> : <Eye />;

export function AiRecommendationCard({
  state,
  recommendation,
  terminal,
  hasLiveContainment,
  onTakeAction,
}: {
  state: QueryState;
  recommendation: RiskRecommendation | null;
  terminal: boolean;
  hasLiveContainment: boolean;
  onTakeAction: () => void;
}): React.JSX.Element {
  return (
    <Card
      title={<CardHeaderTitle icon={<Lightning />} text="Recommended action" badgeTone="purple" />}
      subtitle="What Sentinel suggests you do about this incident, and why"
      actions={
        recommendation !== null ? (
          <div className="aa-rec__chips">
            <span className="aa-chip">{SOURCE_LABEL[recommendation.source]}</span>
            <span className="aa-chip aa-chip--muted">{recommendation.reasoningVersion}</span>
          </div>
        ) : undefined
      }
    >
      {state === 'pending' && <p className="aa-muted aa-pad">Generating recommendation…</p>}
      {state === 'error' && (
        <p className="aa-muted aa-pad" role="alert">
          The recommendation could not be loaded.
        </p>
      )}
      {state === 'ready' && recommendation === null && (
        <p className="aa-muted aa-pad">No recommendation is available for this incident.</p>
      )}
      {state === 'ready' && recommendation !== null && (
        <RecommendationBody
          recommendation={recommendation}
          terminal={terminal}
          hasLiveContainment={hasLiveContainment}
          onTakeAction={onTakeAction}
        />
      )}
    </Card>
  );
}

function RecommendationBody({
  recommendation: r,
  terminal,
  hasLiveContainment,
  onTakeAction,
}: {
  recommendation: RiskRecommendation;
  terminal: boolean;
  hasLiveContainment: boolean;
  onTakeAction: () => void;
}): React.JSX.Element {
  const disabled = terminal || (r.action === 'contain' && hasLiveContainment);
  const disabledNote = terminal
    ? 'This incident is closed and no longer accepts actions.'
    : 'A containment is already proposed for this incident.';

  return (
    <div className="aa-narrative">
      {/* 1. What was detected / Reasons */}
      <div className="aa-narrative-section">
        <h4 className="aa-narrative-subtitle">
          <Reasons /> What was detected
        </h4>
        <ul className="aa-narrative-list">
          {r.keyReasons.map((c) => (
            <li key={c.text}>{c.text}</li>
          ))}
        </ul>
      </div>

      {/* 2. AI Recommendation & Why */}
      <div className="aa-narrative-section aa-narrative-section--highlight">
        <h4 className="aa-narrative-subtitle">
          <Sparkle /> AI Recommendation: {r.actionLabel}
        </h4>
        <p className="aa-narrative-text">{r.rationale}</p>

        {r.alignment === 'diverges' ? (
          <p className="aa-narrative-warning">Note: {r.alignmentNote}</p>
        ) : (
          <p
            className="aa-narrative-text"
            style={{ marginTop: '0.25rem', color: '#15803d', fontWeight: 600 }}
          >
            Aligned
          </p>
        )}
      </div>

      {/* 3. Action Button Only */}
      <div className="aa-narrative-action">
        <button
          type="button"
          className={`aa-btn aa-btn--primary aa-btn--${r.action}`}
          onClick={onTakeAction}
          disabled={disabled}
        >
          {r.actionLabel} <Arrow />
        </button>
        {disabled && <span className="aa-narrative-disabled-note">{disabledNote}</span>}
      </div>

      {(r.degraded || r.rehearsal) && (
        <p className="aa-narrative-note">
          {r.degraded && 'Put together automatically because the live AI was unavailable. '}
          {r.rehearsal && 'Simulation: an executed action would block nobody.'}
        </p>
      )}

      <p className="aa-foot">
        <Lock />
        This is only a recommendation. Nothing happens until you approve it, and it follows your
        existing policies.
      </p>
    </div>
  );
}

const WILL_HAPPEN: Record<RiskAction, string> = {
  contain:
    'This proposes a containment through the policy engine. It still needs approval before it blocks anything — nothing is applied until you approve it.',
  review: 'This moves the incident to Under review. No customer-impacting action is taken.',
  monitor:
    'This records the decision to keep monitoring. No status change and no customer-impacting action.',
};

export function TakeActionModal({
  recommendation: r,
  hasLiveContainment,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  recommendation: RiskRecommendation;
  hasLiveContainment: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="aa-modal" role="dialog" aria-modal="true" aria-label="Confirm action">
      <div className="aa-modal__backdrop" onClick={onClose} />
      <div className="aa-modal__card">
        <h3 className="aa-modal__title">Confirm action</h3>
        <div className={`aa-action aa-action--${ACTION_TONE[r.action]} aa-action--flat`}>
          <span className="aa-action__icon">{actionIcon(r.action)}</span>
          <div className="aa-action__text">
            <strong>{r.actionLabel}</strong>
            <p>{r.rationale}</p>
          </div>
        </div>
        <p className="aa-modal__note">{WILL_HAPPEN[r.action]}</p>
        {r.action === 'contain' && hasLiveContainment && (
          <p className="aa-modal__warn">
            A containment is already proposed — this will not create a second one.
          </p>
        )}
        {error !== null && (
          <p className="aa-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="aa-modal__actions">
          <button
            type="button"
            className="aa-btn aa-btn--ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="aa-btn aa-btn--primary"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
