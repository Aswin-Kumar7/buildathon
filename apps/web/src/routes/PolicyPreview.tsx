import {
  CreditCard,
  ShieldCheck,
  Hand,
  Warning,
  Lock,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { Callout } from '@sentinel/ui';
import type { SimulationResponse } from '@sentinel/contracts';

export function PolicyPreviewCard({
  onPreview,
  pending,
  result,
  error,
  blocked,
}: {
  onPreview: () => void;
  pending: boolean;
  result: SimulationResponse | undefined;
  error: string | null;
  blocked: boolean;
  dirty: boolean;
}): React.JSX.Element {
  return (
    <section className="pol-prev-card">
      <header className="pol-prev-card__head">
        <h2 className="pol-prev-card__title">Preview impact</h2>
        <p className="pol-prev-card__desc">
          See how these settings could affect recent payment activity.
        </p>
      </header>

      <div className="pol-prev-card__body">
        <PreviewBody result={result} error={error} />

        <button
          type="button"
          className="pol-prev-card__btn-run"
          onClick={onPreview}
          disabled={pending || blocked}
          aria-label="Preview impact"
        >
          <ArrowsClockwise size={15} /> {pending ? 'Simulating…' : 'Preview impact'}
        </button>

        <div className="pol-prev-card__lock-note">
          <Lock size={13} /> Replays activity Sentinel already recorded. Changes nothing.
        </div>
      </div>
    </section>
  );
}

function PreviewBody({
  result,
  error,
}: {
  result: SimulationResponse | undefined;
  error: string | null;
}): React.JSX.Element {
  if (error !== null) {
    return (
      <Callout tone="critical" title="We couldn't preview this change">
        <p role="alert">Your current policy hasn't been changed. {error}</p>
      </Callout>
    );
  }
  if (result !== undefined && result.problems.length > 0) {
    return (
      <Callout tone="critical" title="That policy is not usable">
        <ul className="pol-problems">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </Callout>
    );
  }

  // Nothing is shown until a preview has actually run. This block used to fall back to hardcoded
  // 92 / 1 / 0 / 1 whenever `result` was undefined, so the card displayed four invented numbers —
  // under a banner claiming they were "based on incidents Sentinel has already recorded" — before
  // the button had ever been pressed.
  if (result === undefined) {
    return (
      <p className="pol-prev-empty">
        Nothing previewed yet. Run a preview to replay recent recorded activity through these
        settings and see what would change.
      </p>
    );
  }

  const changed = result.rows.filter((row) => row.changed);
  const newlyVerify = changed.filter(
    (row) => row.proposed.action === 'step_up' && row.current.action !== 'step_up',
  ).length;

  const rows: {
    key: string;
    icon: React.JSX.Element;
    label: string;
    value: number;
    tone?: string;
  }[] = [
    {
      key: 'considered',
      icon: <CreditCard size={15} className="pol-prev-row__icon" />,
      label: 'Payments replayed',
      value: result.summary.considered,
    },
    {
      key: 'verify',
      icon: <ShieldCheck size={15} className="pol-prev-row__icon" />,
      label: 'Would newly ask to verify',
      value: newlyVerify,
    },
    {
      key: 'contained',
      icon: <Hand size={15} className="pol-prev-row__icon" />,
      label: 'Would newly be blocked',
      value: result.summary.newlyContained,
      tone: result.summary.newlyContained > 0 ? 'crit' : 'muted',
    },
    {
      key: 'released',
      icon: <Warning size={15} className="pol-prev-row__icon" />,
      label: 'Blocks that would be released',
      value: result.summary.newlyReleased,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {result.summary.changed > 0 ? (
        <Callout tone="warn" title="This policy would decide differently">
          <p style={{ margin: 0, opacity: 0.9 }}>
            {result.summary.changed} of {result.summary.considered} replayed payments would get a
            different decision.
          </p>
        </Callout>
      ) : (
        <Callout tone="ok" title="No change">
          <p>This policy produces identical decisions on recent activity.</p>
        </Callout>
      )}
      <div className="pol-prev-rows">
        {rows.map((row) => (
          <div className="pol-prev-row" key={row.key}>
            <span className="pol-prev-row__left">
              {row.icon}
              <span>{row.label}</span>
            </span>
            <strong
              className={`pol-prev-row__val${row.tone !== undefined ? ` pol-prev-row__val--${row.tone}` : ''}`}
            >
              {row.value}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
