import type { PolicyResponse, PolicyVersion } from '@sentinel/contracts';
import { fmtDateTime } from './policy-ui.js';

export function ActivePolicyCard({
  policy,
  versions,
}: {
  policy: PolicyResponse;
  versions: PolicyVersion[];
}): React.JSX.Element {
  const record = versions.find((version) => version.hash === policy.hash) ?? null;
  const isFromFile = record === null;

  return (
    <section className="pol-active-card">
      <header className="pol-active-card__head">
        <h2 className="pol-active-card__title">Active policy</h2>
        <span className="pol-active-card__badge">{isFromFile ? 'From file' : record.status}</span>
      </header>

      <div className="pol-active-card__rows">
        <div className="pol-active-card__row">
          <span className="pol-active-card__label">Version</span>
          <span className="pol-active-card__value pol-active-card__value--bold">
            v{policy.version}
          </span>
        </div>
        <div className="pol-active-card__row">
          <span className="pol-active-card__label">Published on</span>
          <span className="pol-active-card__value">
            {record?.publishedAt ? fmtDateTime(record.publishedAt) : '—'}
          </span>
        </div>
        <div className="pol-active-card__row">
          <span className="pol-active-card__label">Approved by</span>
          <span className="pol-active-card__value">
            {record?.approvedByName ?? record?.createdByName ?? '—'}
          </span>
        </div>
        <div className="pol-active-card__row">
          <span className="pol-active-card__label">Policy hash</span>
          <span className="pol-active-card__hash">{policy.hash}</span>
        </div>
      </div>

      {policy.killSwitch && (
        <p className="pol-active-card__note" role="status">
          This published policy has its kill-switch field set on, so under it Sentinel takes no
          action. Changing that means publishing a new policy.
        </p>
      )}
    </section>
  );
}
