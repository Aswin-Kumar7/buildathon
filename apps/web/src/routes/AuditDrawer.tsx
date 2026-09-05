import { useEffect, useState } from 'react';
import type { AuditEntry } from '@sentinel/contracts';
import { fmtDateTime, kindLabel } from '../incidents/audit-words.js';
import {
  ArrowsLeftRight,
  CheckCircle,
  Copy,
  Check,
  CaretUp,
  CaretDown,
  Info,
  X,
  Code,
} from '@phosphor-icons/react';

function asRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function AuditDrawer({
  entry,
  nextHash,
  onClose,
}: {
  entry: AuditEntry;
  nextHash: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const [metaOpen, setMetaOpen] = useState(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const actorName = entry.actor ?? 'system';
  const initials = actorName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const payload = asRecord(entry.payload);
  const fromState =
    typeof payload['from'] === 'string'
      ? payload['from']
      : typeof payload['fromState'] === 'string'
        ? payload['fromState']
        : null;
  const toState =
    typeof payload['to'] === 'string'
      ? payload['to']
      : typeof payload['toState'] === 'string'
        ? payload['toState']
        : null;

  // Build metadata key-value list for table
  const metaRows: Array<{ key: string; val: string }> = [];
  metaRows.push({ key: 'version', val: String(entry.policyVersion ?? entry.seq) });
  metaRows.push({ key: 'subjectType', val: entry.subjectType });
  metaRows.push({ key: 'subjectId', val: entry.subjectId });
  const fmtState = (st: string) => st.charAt(0).toUpperCase() + st.slice(1).replace(/_/g, ' ');
  if (fromState !== null) metaRows.push({ key: 'fromState', val: fmtState(fromState) });
  if (toState !== null) metaRows.push({ key: 'toState', val: fmtState(toState) });

  for (const [k, v] of Object.entries(payload)) {
    if (['from', 'to', 'fromState', 'toState'].includes(k)) continue;
    metaRows.push({
      key: k,
      val: typeof v === 'object' ? JSON.stringify(v) : String(v),
    });
  }

  return (
    <aside className="auddr" role="dialog" aria-modal="false" aria-label="Audit event details">
      {/* Header */}
      <header className="auddr__head">
        <h2>Audit event details</h2>
        <button type="button" className="auddr__x" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </header>

      <div className="auddr__content">
        {/* Banner */}
        <div className="auddr__banner">
          <div className="auddr__banner-left">
            <span className="auddr__banner-icon">
              <ArrowsLeftRight size={16} />
            </span>
            <span className="auddr__banner-title">{kindLabel(entry.kind)}</span>
          </div>
          <span className="auddr__event-num">Event #{entry.seq}</span>
        </div>

        {/* 2-Column Meta Grid */}
        <div className="auddr__grid">
          <div className="auddr__grid-col">
            <span className="auddr__grid-label">When</span>
            <span className="auddr__grid-val">{fmtDateTime(entry.at)}</span>
          </div>
          <div className="auddr__grid-col">
            <span className="auddr__grid-label">Performed by</span>
            <div className="auddr__actor">
              <span className="auddr__actor-avatar">{initials}</span>
              <span className="auddr__grid-val">{actorName}</span>
            </div>
          </div>
        </div>

        {/* HASH CHAIN */}
        <div className="auddr__chain-sec">
          <div className="auddr__chain-head">
            <span className="auddr__sec-label">HASH CHAIN</span>
            <span className="auddr__verified-badge">
              <CheckCircle size={13} weight="fill" /> Link verified
            </span>
          </div>

          <div className="auddr__timeline">
            {/* Previous entry */}
            <div className="auddr__tl-item">
              <div className="auddr__tl-node auddr__tl-node--open" />
              <div className="auddr__tl-content">
                <span className="auddr__tl-label">PREVIOUS ENTRY · #{entry.seq - 1}</span>
                <HashBox value={entry.prevHash} isCurrent={false} />
              </div>
            </div>

            {/* Current entry */}
            <div className="auddr__tl-item">
              <div className="auddr__tl-node auddr__tl-node--current" />
              <div className="auddr__tl-content">
                <span className="auddr__tl-label auddr__tl-label--current">
                  THIS ENTRY · #{entry.seq}
                </span>
                <HashBox value={entry.hash} isCurrent={true} />
              </div>
            </div>

            {/* Next entry */}
            <div className="auddr__tl-item">
              <div className="auddr__tl-node auddr__tl-node--dotted" />
              <div className="auddr__tl-content">
                <span className="auddr__tl-label">NEXT ENTRY</span>
                {nextHash !== null ? (
                  <HashBox value={nextHash} isCurrent={false} />
                ) : (
                  <span className="auddr__latest-note">Latest entry — head of the chain</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Additional metadata accordion */}
        <div className="auddr__meta-accordion">
          <button
            type="button"
            className="auddr__meta-trigger"
            onClick={() => setMetaOpen((prev) => !prev)}
            aria-expanded={metaOpen}
          >
            <span className="auddr__meta-trigger-left">
              <Code size={15} />
              <span>Additional metadata</span>
            </span>
            {metaOpen ? <CaretUp size={14} /> : <CaretDown size={14} />}
          </button>

          {metaOpen && (
            <div className="auddr__meta-table-wrap">
              <table className="auddr__meta-table">
                <tbody>
                  {metaRows.map((r) => (
                    <tr key={r.key}>
                      <td className="auddr__meta-key">{r.key}</td>
                      <td className="auddr__meta-val">{r.val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="auddr__callout-box">
                <Info size={16} className="auddr__callout-ico" />
                <p>
                  This record is immutable and part of the cryptographic audit chain. Changing it
                  would break the link the next entry recorded, and the verifier would report
                  exactly where.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function HashBox({ value, isCurrent }: { value: string; isCurrent: boolean }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  };

  return (
    <div className={`auddr__hash-box ${isCurrent ? 'auddr__hash-box--current' : ''}`}>
      <code className="auddr__hash-text">{value}</code>
      <button type="button" className="auddr__hash-copy" onClick={copy} title="Copy hash">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
