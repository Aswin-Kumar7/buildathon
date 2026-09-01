import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { AuditEntry } from '@sentinel/contracts';
import { fmtDateTime, kindLabel, kindTone, statusLabel } from '../incidents/audit-words.js';
import {
  ArrowRight as ArrowIcon,
  ArrowSquareOut as ExternalIcon,
  Copy as CopyIcon,
  Check as CheckIcon,
  CaretDown as ChevronIcon,
  Info as InfoIcon,
} from '@phosphor-icons/react';

const incidentRef = (id: string): string => `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

function asRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * The read-only detail of a single audit entry, attached to the right edge of the app.
 *
 * Everything shown is a field of the entry the list already returned — no second request. The chain
 * links (this hash, the previous, and the next entry's hash, derived from the row after it) are shown
 * so an operator can follow the record by hand, exactly as the verifier does.
 */
export function AuditDrawer({
  entry,
  nextHash,
  onClose,
}: {
  entry: AuditEntry;
  nextHash: string | null;
  onClose: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="auddr" role="dialog" aria-modal="false" aria-label="Audit event details">
      <header className="auddr__head">
        <h2>Audit event details</h2>
        <button type="button" className="auddr__x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="auddr__badge">
        <span className={`aud-badge aud-badge--${kindTone(entry.kind)}`}>
          {kindLabel(entry.kind)}
        </span>
        <span className="auddr__num">Event #{entry.seq}</span>
      </div>

      <DrawerBody entry={entry} nextHash={nextHash} onClose={onClose} />
    </aside>
  );
}

function DrawerBody({
  entry,
  nextHash,
  onClose,
}: {
  entry: AuditEntry;
  nextHash: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const payload = asRecord(entry.payload);
  const from = typeof payload['from'] === 'string' ? payload['from'] : null;
  const to = typeof payload['to'] === 'string' ? payload['to'] : null;
  const note = typeof payload['note'] === 'string' ? payload['note'] : null;
  const relatedIncident = entry.subjectType === 'incident' ? entry.subjectId : null;

  return (
    <div className="auddr__body">
      <Section label="When">
        <span className="auddr__val">{fmtDateTime(entry.at)}</span>
      </Section>
      <Section label="Performed by">
        <span className="auddr__val">{entry.actor ?? 'system'}</span>
      </Section>

      {from !== null && to !== null && (
        <Section label="Change">
          <div className="auddr__change">
            <span>{statusLabel(from)}</span>
            <ArrowIcon />
            <strong>{statusLabel(to)}</strong>
          </div>
        </Section>
      )}

      {note !== null && (
        <Section label="Reason">
          <p className="auddr__reason">{note}</p>
        </Section>
      )}

      {relatedIncident !== null && (
        <Section label="Related incident">
          <Link
            to="/console/incidents/$id"
            params={{ id: relatedIncident }}
            className="auddr__link"
            onClick={onClose}
          >
            {incidentRef(relatedIncident)} <ExternalIcon />
          </Link>
        </Section>
      )}

      <HashField label="Audit hash" value={entry.hash} />
      <HashField label="Previous hash" value={entry.prevHash} />
      {nextHash !== null ? (
        <HashField label="Next hash" value={nextHash} />
      ) : (
        <Section label="Next hash">
          <span className="auddr__muted">This is the latest entry — the head of the chain.</span>
        </Section>
      )}

      <Metadata entry={entry} shown={{ from, to, note }} />

      <p className="auddr__immutable">
        <InfoIcon /> This record is immutable and part of the cryptographic audit chain. Changing it
        would break the link the next entry recorded, and the verifier would report exactly where.
      </p>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="auddr__section">
      <span className="auddr__label">{label}</span>
      {children}
    </div>
  );
}

function HashField({ label, value }: { label: string; value: string }): React.JSX.Element {
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
    <div className="auddr__section">
      <span className="auddr__label">{label}</span>
      <div className="auddr__hash">
        <code title={value}>{value}</code>
        <button type="button" className="auddr__copy" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  );
}

function Metadata({
  entry,
  shown,
}: {
  entry: AuditEntry;
  shown: { from: string | null; to: string | null; note: string | null };
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const payload = asRecord(entry.payload);
  const rows: [string, string][] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'from' && shown.from !== null) continue;
    if (key === 'to' && shown.to !== null) continue;
    if (key === 'note' && shown.note !== null) continue;
    rows.push([key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
  }
  if (entry.policyVersion !== null) rows.push(['policyVersion', String(entry.policyVersion)]);
  if (entry.policyHash !== null) rows.push(['policyHash', entry.policyHash]);
  rows.push(['subjectType', entry.subjectType]);
  rows.push(['subjectId', entry.subjectId]);
  if (rows.length === 0) return null;

  return (
    <div className={`auddr__meta${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="auddr__metabar"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Additional metadata <ChevronIcon />
      </button>
      {open && (
        <dl className="auddr__metalist">
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
