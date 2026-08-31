import { useState } from 'react';
import { TrendUp, X, Checks, SignOut, LockKey } from '@phosphor-icons/react';
import { Button, Callout } from '@sentinel/ui';
import type { SimulationResponse, SimulationRow } from '@sentinel/contracts';
import { actionLabel, decisionCode, rupees } from '../incidents/policy-words.js';

/**
 * The impact preview. Every number here comes straight from POST /api/policy/simulate run against
 * incidents that already happened — nothing is computed in the browser. Costs are the engine's own
 * per-decision estimates, shown on both sides and never averaged, and labelled as estimates.
 */
export function PolicyPreviewCard({
  onPreview,
  pending,
  result,
  error,
  blocked,
  dirty,
}: {
  onPreview: () => void;
  pending: boolean;
  result: SimulationResponse | undefined;
  error: string | null;
  blocked: boolean;
  dirty: boolean;
}): React.JSX.Element {
  return (
    <section className="pol-card pol-preview">
      <header className="pol-preview__head">
        <h2>Preview impact</h2>
        <p>See how these settings could affect recent payment activity.</p>
      </header>

      <div className="pol-preview__scope">
        <TrendUp /> Based on incidents Sentinel has already recorded.
      </div>

      <PreviewBody pending={pending} result={result} error={error} dirty={dirty} />

      <Button className="pol-preview__cta" onClick={onPreview} disabled={pending || blocked}>
        {pending ? 'Previewing…' : 'Preview impact'}
      </Button>
      <p className="pol-preview__foot">
        <LockKey /> No changes are saved until you create a draft.
      </p>
    </section>
  );
}

function PreviewBody({
  pending,
  result,
  error,
  dirty,
}: {
  pending: boolean;
  result: SimulationResponse | undefined;
  error: string | null;
  dirty: boolean;
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
  if (pending)
    return (
      <p className="pol-preview__hint" role="status">
        Previewing against recorded incidents…
      </p>
    );
  if (result === undefined) {
    return (
      <p className="pol-preview__hint">
        {dirty
          ? 'Preview to see how your changes would have affected recent activity.'
          : 'Change a setting, then preview its impact here.'}
      </p>
    );
  }
  return <Results result={result} />;
}

function Results({ result }: { result: SimulationResponse }): React.JSX.Element {
  const changed = result.rows.filter((row) => row.changed);
  const newlyVerify = changed.filter(
    (row) => row.proposed.action === 'step_up' && row.current.action !== 'step_up',
  ).length;
  const costAct = changed.reduce((sum, row) => sum + row.proposed.expectedCost.ifWeAct, 0);
  const costWait = changed.reduce((sum, row) => sum + row.proposed.expectedCost.ifWeWait, 0);

  return (
    <>
      <ul className="pol-impact">
        <Metric
          icon={<X />}
          tone="crit"
          label="More payments blocked"
          delta={result.summary.newlyContained}
        />
        <Metric
          icon={<Checks />}
          tone="warn"
          label="Customers asked to verify"
          delta={newlyVerify}
        />
        <Metric
          icon={<SignOut />}
          tone="ok"
          label="Blocks removed"
          delta={result.summary.newlyReleased}
        />
      </ul>
      <p className="pol-impact__base">
        {result.summary.changed} of {result.summary.considered} recorded{' '}
        {result.summary.considered === 1 ? 'incident' : 'incidents'} would be decided differently.
      </p>

      {changed.length > 0 && (
        <div className="pol-estimate">
          <div className="pol-estimate__head">
            <strong>Estimated impact</strong>
            <span>(order-of-magnitude estimate)</span>
          </div>
          <div className="pol-estimate__rows">
            <div>
              <span>Exposure if Sentinel does not act</span>
              <strong className="pol-estimate__wait">{rupees(costWait)}</strong>
            </div>
            <div>
              <span>Cost if Sentinel acts</span>
              <strong className="pol-estimate__act">{rupees(costAct)}</strong>
            </div>
          </div>
          <p className="pol-estimate__note">
            Summed from the engine’s per-decision estimates. Not accounting figures, and the two
            sides are never combined.
          </p>
        </div>
      )}

      {result.summary.newlyContained > 0 && (
        <Callout tone="warn" title="This would block people it does not block today">
          <p>
            {result.summary.newlyContained} of {result.summary.considered} would newly be refused.
            Each is a shopper who gets through now and would not.
          </p>
        </Callout>
      )}

      {changed.length > 0 && <ChangedDetail rows={changed} />}
    </>
  );
}

function Metric({
  icon,
  tone,
  label,
  delta,
}: {
  icon: React.ReactNode;
  tone: 'crit' | 'warn' | 'ok';
  label: string;
  delta: number;
}): React.JSX.Element {
  return (
    <li className="pol-metric">
      <span className={`pol-metric__ico pol-metric__ico--${tone}`}>{icon}</span>
      <span className="pol-metric__label">{label}</span>
      <strong className="pol-metric__value">{delta > 0 ? `+${delta}` : delta}</strong>
    </li>
  );
}

function ChangedDetail({ rows }: { rows: SimulationRow[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="pol-changed">
      <button
        type="button"
        className="pol-changed__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Hide' : 'See'} which decisions change ({rows.length})
      </button>
      {open && (
        <ul className="pol-changed__list">
          {rows.map((row) => (
            <li key={row.incidentId} className="pol-changed__row">
              <div className="pol-changed__head">
                <span className="pol-changed__entity">
                  {row.entityKind} <code>{row.entityKey.replace(/^v\d+:/, '').slice(0, 10)}</code>
                </span>
                <span className="pol-changed__flow">
                  {actionLabel(row.current.action)} →{' '}
                  <strong>{actionLabel(row.proposed.action)}</strong>
                </span>
              </div>
              {row.proposed.reasons.length > 0 && (
                <ul className="pol-changed__reasons">
                  {row.proposed.reasons.map((code) => (
                    <li key={code}>{decisionCode(code)}</li>
                  ))}
                </ul>
              )}
              {row.proposed.refusals.length > 0 && (
                <ul className="pol-changed__refusals">
                  {row.proposed.refusals.map((code) => (
                    <li key={code}>Held back: {decisionCode(code)}</li>
                  ))}
                </ul>
              )}
              <div className="pol-changed__facts">
                {row.proposed.approvalsRequired > 0 && (
                  <span>
                    {row.proposed.approvalsRequired} approval
                    {row.proposed.approvalsRequired === 1 ? '' : 's'} needed
                  </span>
                )}
                <span>
                  If acts {rupees(row.proposed.expectedCost.ifWeAct)} · if waits{' '}
                  {rupees(row.proposed.expectedCost.ifWeWait)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
