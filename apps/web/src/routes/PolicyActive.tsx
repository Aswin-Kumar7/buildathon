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
        {/* What this policy is, not the raw column value — that printed a lower-case "published". */}
        <span className="pol-active-card__badge">{isFromFile ? 'From file' : 'Live'}</span>
      </header>

      <div className="pol-active-card__rows">
        <div className="pol-active-card__row">
          <span className="pol-active-card__label">Version</span>
          <span className="pol-active-card__value pol-active-card__value--bold">
            v{policy.version}
          </span>
        </div>
        {/*
         * A policy loaded from the file shipped with the build has no publish date and no approver,
         * because nobody ever published it. These rows used to print two bare em-dashes, which read
         * as missing data rather than as the truth: this policy never went through the workflow.
         */}
        {isFromFile ? (
          <div className="pol-active-card__row pol-active-card__row--note">
            <span className="pol-active-card__label">Provenance</span>
            <span className="pol-active-card__value">
              Never published — running the default shipped with this build
            </span>
          </div>
        ) : (
          <>
            <div className="pol-active-card__row">
              <span className="pol-active-card__label">Published on</span>
              <span className="pol-active-card__value">
                {record.publishedAt ? fmtDateTime(record.publishedAt) : 'Not yet published'}
              </span>
            </div>
            <div className="pol-active-card__row">
              {/* There is no approval step any more, so this names who made it live. */}
              <span className="pol-active-card__label">Saved by</span>
              <span className="pol-active-card__value">{record.createdByName ?? '—'}</span>
            </div>
          </>
        )}
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
