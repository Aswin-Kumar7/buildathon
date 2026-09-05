import {
  Lightning,
  Sparkle,
  LockSimple,
  CheckCircle,
  CreditCard,
  WarningCircle,
  Laptop,
} from '@phosphor-icons/react';
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

const actionIcon = (action: RiskAction): React.JSX.Element =>
  action === 'contain' ? (
    <Lightning size={16} color="oklch(0.48 0.15 22)" />
  ) : (
    <Sparkle size={16} color="oklch(0.46 0.12 258)" />
  );

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
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 32px',
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              background: 'oklch(0.962 0.024 258)',
            }}
          >
            <Lightning size={16} color="oklch(0.46 0.12 258)" />
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
              Recommended action
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
              What Sentinel suggests you do about this incident, and why.
            </p>
          </div>
        </div>

        {recommendation !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'oklch(0.42 0.12 258)',
                background: 'oklch(0.962 0.024 258)',
              }}
            >
              {SOURCE_LABEL[recommendation.source]}
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
              {recommendation.reasoningVersion}
            </span>
          </div>
        )}
      </div>

      {state === 'pending' && (
        <p
          style={{
            padding: '16px 20px',
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Generating recommendation…
        </p>
      )}
      {state === 'error' && (
        <p
          style={{
            padding: '16px 20px',
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'oklch(0.48 0.15 22)',
          }}
          role="alert"
        >
          The recommendation could not be loaded.
        </p>
      )}
      {state === 'ready' && recommendation === null && (
        <p
          style={{
            padding: '16px 20px',
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          No recommendation is available for this incident.
        </p>
      )}
      {state === 'ready' && recommendation !== null && (
        <RecommendationBody
          recommendation={recommendation}
          terminal={terminal}
          hasLiveContainment={hasLiveContainment}
          onTakeAction={onTakeAction}
        />
      )}
    </section>
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* WHAT WAS DETECTED */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '16px 20px 0',
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
          WHAT WAS DETECTED
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {r.keyReasons.map((c) => {
            const lower = c.text.toLowerCase();
            return (
              <div key={c.text} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {lower.includes('card') ? (
                  <CreditCard size={16} color="oklch(0.58 0.015 280)" />
                ) : lower.includes('failed') || lower.includes('failure') ? (
                  <WarningCircle size={16} color="oklch(0.58 0.015 280)" />
                ) : (
                  <Laptop size={16} color="oklch(0.58 0.015 280)" />
                )}
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'oklch(0.26 0.015 280)',
                  }}
                >
                  {c.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Recommendation Box */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          margin: '18px 20px',
          padding: '14px 15px',
          borderRadius: '10px',
          background: 'oklch(0.988 0.002 270)',
          border: '1px solid oklch(0.95 0.006 280)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkle size={15} color="oklch(0.46 0.12 258)" />
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
            AI recommendation: <span>{r.actionLabel}</span>
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '12.5px',
            fontWeight: 500,
            lineHeight: 1.65,
            color: 'oklch(0.44 0.015 280)',
            textWrap: 'pretty',
          }}
        >
          {r.rationale}
        </p>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            width: 'fit-content',
            padding: '3px 10px',
            borderRadius: 'var(--s-radius-pill)',
            fontSize: '11.5px',
            fontWeight: 600,
            color: 'oklch(0.4 0.11 162)',
            background: 'oklch(0.955 0.03 162)',
          }}
        >
          <CheckCircle size={13} color="oklch(0.4 0.11 162)" />
          Aligned
        </span>
      </div>

      {/* Action Row & Lock Note */}
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px 18px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onTakeAction}
            disabled={disabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 15px',
              border: disabled
                ? '1px solid oklch(0.93 0.006 280)'
                : '1px solid oklch(0.35 0.16 250)',
              borderRadius: '8px',
              fontFamily: 'inherit',
              fontSize: '12.5px',
              fontWeight: 600,
              color: disabled ? 'oklch(0.62 0.015 280)' : '#ffffff',
              background: disabled ? 'oklch(0.972 0.004 270)' : 'oklch(0.35 0.16 250)',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {r.actionLabel} →
          </button>
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'oklch(0.58 0.015 280)' }}>
            {disabledNote}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LockSimple size={13} color="oklch(0.66 0.015 280)" />
          <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'oklch(0.58 0.015 280)' }}>
            This is only a recommendation. Nothing happens until you approve it, and it follows your
            existing policies.
          </span>
        </div>
      </div>
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
