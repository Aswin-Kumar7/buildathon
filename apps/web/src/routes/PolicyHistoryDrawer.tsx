import { useEffect, useState } from 'react';
import { ArrowCounterClockwise, CaretDown, CaretUp, X } from '@phosphor-icons/react';
import type { PolicyResponse, PolicyVersion } from '@sentinel/contracts';
import { fmtDateTime } from './policy-ui.js';
import { pct } from './policy-draft.js';

/**
 * Policy history, as a right-hand drawer you can act from.
 *
 * It replaces a centred modal that was too narrow for the table it held. The shape matches the audit
 * trail's event drawer deliberately: both answer "what happened, and what can I do about it" for one
 * record at a time.
 *
 * Every entry is shown by what is actually true of it — whether it was ever the live policy — rather
 * than by the draft/pending/approved lifecycle, which no longer exists. Versions from before that
 * removal are still in the table and are labelled honestly as never having gone live.
 */

type Standing = { label: string; tone: 'live' | 'past' | 'never' };

function standingOf(version: PolicyVersion, liveHash: string | null): Standing {
  if (version.hash === liveHash) return { label: 'Live', tone: 'live' };
  if (version.status === 'published') return { label: 'Previously live', tone: 'past' };
  // A leftover from the old approval workflow: written, never activated.
  return { label: 'Never live', tone: 'never' };
}

export function PolicyHistoryDrawer({
  versions,
  loading,
  policy,
  reverting,
  onRevert,
  onClose,
}: {
  versions: PolicyVersion[];
  loading: boolean;
  policy: PolicyResponse | undefined;
  reverting: boolean;
  onRevert: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const liveHash = policy?.hash ?? null;

  return (
    <>
      <div className="polhx__scrim" role="presentation" onClick={onClose} />
      <aside className="polhx" role="dialog" aria-modal="true" aria-labelledby="polhx-title">
        <header className="polhx__head">
          <div>
            <h2 className="polhx__title" id="polhx-title">
              Policy history
            </h2>
            <p className="polhx__sub">
              Every version, newest first. Restoring writes the old settings forward as a new
              version — nothing here is ever edited or deleted.
            </p>
          </div>
          <button type="button" className="polhx__x" onClick={onClose} aria-label="Close history">
            <X size={16} />
          </button>
        </header>

        <div className="polhx__content">
          {loading ? (
            <p className="polhx__empty" role="status">
              Loading history…
            </p>
          ) : versions.length === 0 ? (
            <p className="polhx__empty">No policy versions yet.</p>
          ) : (
            versions.map((version) => (
              <HistoryEntry
                key={version.id}
                version={version}
                standing={standingOf(version, liveHash)}
                live={policy}
                reverting={reverting}
                onRevert={onRevert}
              />
            ))
          )}
        </div>
      </aside>
    </>
  );
}

/** One version in the drawer: what it is, when it ran, and the one action available on it. */
function HistoryEntry({
  version,
  standing,
  live,
  reverting,
  onRevert,
}: {
  version: PolicyVersion;
  standing: Standing;
  live: PolicyResponse | undefined;
  reverting: boolean;
  onRevert: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const isLive = standing.tone === 'live';
  return (
    <article className={`polhx__item${isLive ? ' is-live' : ''}`}>
      <div className="polhx__item-top">
        <span className="polhx__ver">v{version.version}</span>
        <span className={`polhx__standing polhx__standing--${standing.tone}`}>
          {standing.label}
        </span>
      </div>

      <code className="polhx__hash">{version.hash}</code>

      <dl className="polhx__meta">
        <div>
          <dt>Saved by</dt>
          <dd>{version.createdByName ?? '—'}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{fmtDateTime(version.createdAt)}</dd>
        </div>
        <div>
          <dt>Went live</dt>
          <dd>{version.publishedAt === null ? 'Never' : fmtDateTime(version.publishedAt)}</dd>
        </div>
      </dl>

      <button
        type="button"
        className="polhx__disclose"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <CaretUp size={12} /> : <CaretDown size={12} />}
        {open ? 'Hide settings' : 'What is in this version'}
      </button>

      {open && <VersionSettings version={version} live={live} />}

      <div className="polhx__actions">
        {isLive ? (
          <span className="polhx__running">Running now</span>
        ) : (
          <button
            type="button"
            className="polhx__restore"
            disabled={reverting}
            onClick={() => onRevert(version.id)}
          >
            <ArrowCounterClockwise size={13} />
            {reverting ? 'Restoring…' : 'Restore this version'}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * What a version actually holds, and which of those values differ from what is running now — so
 * "restore this" is a decision made on the settings rather than on a version number.
 */
function VersionSettings({
  version,
  live,
}: {
  version: PolicyVersion;
  live: PolicyResponse | undefined;
}): React.JSX.Element {
  const settings = version.settings;
  if (settings === null) {
    return (
      <p className="polhx__unreadable">
        This version&rsquo;s stored settings can no longer be read, so they are not shown rather
        than guessed at. Restoring it would be refused for the same reason.
      </p>
    );
  }

  const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString('en-IN')}`;
  const rows: { label: string; value: string; changed: boolean }[] = [
    {
      label: 'Ask for verification when',
      value: pct(settings.stepUp),
      changed: live !== undefined && live.thresholds.stepUp !== settings.stepUp,
    },
    {
      label: 'Block suspicious activity when',
      value: pct(settings.contain),
      changed: live !== undefined && live.thresholds.contain !== settings.contain,
    },
    {
      label: 'Block duration',
      value: `${settings.defaultMinutes} min`,
      changed: live !== undefined && live.containment.defaultMinutes !== settings.defaultMinutes,
    },
    {
      label: 'Longest a block can last',
      value: `${settings.maxMinutes} min`,
      changed: live !== undefined && live.containment.maxMinutes !== settings.maxMinutes,
    },
    {
      label: 'Require approval before blocking',
      value: settings.containmentAlwaysNeedsApproval ? 'On' : 'Off',
      changed:
        live !== undefined &&
        live.approval.containmentAlwaysNeedsApproval !== settings.containmentAlwaysNeedsApproval,
    },
    {
      label: 'Approval required above',
      value: rupees(settings.dualApprovalAbovePaise),
      changed:
        live !== undefined &&
        live.approval.dualApprovalAbovePaise !== settings.dualApprovalAbovePaise,
    },
  ];

  return (
    <ul className="polhx__settings">
      {rows.map((row) => (
        <li className={`polhx__setting${row.changed ? ' is-changed' : ''}`} key={row.label}>
          <span className="polhx__setting-label">{row.label}</span>
          <span className="polhx__setting-value">
            {row.value}
            {row.changed && <span className="polhx__delta">differs from live</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
