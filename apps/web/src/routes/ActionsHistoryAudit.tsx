import { useState } from 'react';
import { FileCode } from '@phosphor-icons/react';
import { Clock } from '@phosphor-icons/react';
import { Card } from '@sentinel/ui';
import type { AuditEntry, ContainmentDto, IncidentDetail } from '@sentinel/contracts';
import { kindLabel, payloadSummary } from '../incidents/audit-words.js';
import type { QueryState } from './IncidentActionsAudit.js';

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

type Tone = 'ok' | 'warn' | 'critical' | 'neutral';
interface ActionRow {
  key: string;
  action: string;
  type: string;
  status: string;
  tone: Tone;
  by: string;
  at: number;
  notes: string;
}

const CONTAINMENT_ACTION_LABEL: Record<string, string> = {
  contain: 'Block suspicious activity',
  step_up: 'Step-up challenge',
  observe: 'Observe',
  escalate: 'Escalate',
  release: 'Release',
};
const TRANSITION_ACTION: Record<string, string> = {
  under_review: 'Review incident',
  contained: 'Contain incident',
  resolved: 'Resolve incident',
  expired: 'Incident expired',
  open: 'Reopen incident',
};

function eventAction(kind: string, action: string): string {
  if (kind === 'proposed') return 'Propose containment';
  if (kind === 'approved') return CONTAINMENT_ACTION_LABEL[action] ?? 'Containment';
  if (kind === 'rejected') return 'Reject containment';
  if (kind === 'released') return 'Release containment';
  if (kind === 'expired') return 'Containment expired';
  if (kind === 'extended') return 'Extend containment';
  return kind;
}
function eventStatus(kind: string): { label: string; tone: Tone } {
  if (kind === 'proposed') return { label: 'Proposed', tone: 'warn' };
  if (kind === 'approved') return { label: 'Approved', tone: 'ok' };
  if (kind === 'rejected') return { label: 'Rejected', tone: 'critical' };
  if (kind === 'expired') return { label: 'Expired', tone: 'neutral' };
  if (kind === 'released') return { label: 'Released', tone: 'neutral' };
  if (kind === 'extended') return { label: 'Extended', tone: 'ok' };
  return { label: kind, tone: 'neutral' };
}

function buildRows(incident: IncidentDetail, containments: ContainmentDto[]): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const c of containments) {
    c.history.forEach((ev, index) => {
      if (ev.kind === 'activated') return; // system step, redundant with 'approved'
      const status = eventStatus(ev.kind);
      rows.push({
        key: `c-${c.id}-${index}`,
        action: eventAction(ev.kind, c.action),
        type: 'Containment',
        status: status.label,
        tone: status.tone,
        by: ev.actor ?? 'System',
        at: ev.at,
        notes: ev.note ?? '',
      });
    });
  }
  incident.history.forEach((h, index) => {
    rows.push({
      key: `t-${index}`,
      action: TRANSITION_ACTION[h.to] ?? `Move to ${h.to}`,
      type: 'Status change',
      status: 'Completed',
      tone: 'ok',
      by: h.actor ?? 'System',
      at: h.at,
      notes: h.note ?? `Moved to ${h.to.replace(/_/g, ' ')}`,
    });
  });
  return rows.sort((a, b) => b.at - a.at);
}

const stamp = (at: number): string =>
  new Date(at).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ActionHistory({
  incident,
  containments,
  resolvable,
  onResolve,
  resolvePending,
  resolveError,
}: {
  incident: IncidentDetail;
  containments: ContainmentDto[];
  resolvable: boolean;
  onResolve: (verdict: 'confirmed_abuse' | 'false_positive') => void;
  resolvePending: boolean;
  resolveError: string | null;
}): React.JSX.Element {
  const rows = buildRows(incident, containments);
  return (
    <Card
      title={<CardHeaderTitle icon={<Clock />} text="Action history" badgeTone="amber" />}
      subtitle="Actions taken on this incident"
    >
      {rows.length === 0 ? (
        <p className="aa-muted aa-pad">No actions taken yet.</p>
      ) : (
        <div className="aa-table-wrap">
          <table className="aa-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Type</th>
                <th>Status</th>
                <th>By</th>
                <th>At</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="aa-strong">{row.action}</td>
                  <td className="aa-muted">{row.type}</td>
                  <td>
                    <span className={`aa-pill aa-pill--${row.tone}`}>{row.status}</span>
                  </td>
                  <td>{row.by}</td>
                  <td className="aa-nowrap aa-muted">{stamp(row.at)}</td>
                  <td className="aa-notes">{row.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resolvable && (
        <ResolveFooter onResolve={onResolve} pending={resolvePending} error={resolveError} />
      )}
    </Card>
  );
}

function ResolveFooter({
  onResolve,
  pending,
  error,
}: {
  onResolve: (verdict: 'confirmed_abuse' | 'false_positive') => void;
  pending: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <div className="aa-resolve">
      <span className="aa-resolve__label">Close this incident with your verdict:</span>
      <div className="aa-resolve__actions">
        <button
          type="button"
          className="aa-btn aa-btn--ghost"
          disabled={pending}
          onClick={() => onResolve('confirmed_abuse')}
        >
          Confirmed abuse
        </button>
        <button
          type="button"
          className="aa-btn aa-btn--ghost"
          disabled={pending}
          onClick={() => onResolve('false_positive')}
        >
          False positive
        </button>
      </div>
      {error !== null && (
        <p className="aa-modal__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const PAGE = 6;

export function AuditLog({
  state,
  entries,
}: {
  state: QueryState;
  entries: AuditEntry[];
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE));
  const current = Math.min(page, pageCount);
  const shown = entries.slice((current - 1) * PAGE, current * PAGE);

  return (
    <Card
      title={<CardHeaderTitle icon={<FileCode />} text="Audit log" badgeTone="blue" />}
      subtitle="All changes and events related to this incident"
    >
      {state === 'pending' && <p className="aa-muted aa-pad">Loading the audit log…</p>}
      {state === 'error' && (
        <p className="aa-muted aa-pad" role="alert">
          The audit log could not be loaded.
        </p>
      )}
      {state === 'ready' && entries.length === 0 && (
        <p className="aa-muted aa-pad">Nothing has been recorded against this incident yet.</p>
      )}
      {state === 'ready' && entries.length > 0 && (
        <>
          <ol className="aa-timeline">
            {shown.map((entry) => (
              <AuditRow key={entry.seq} entry={entry} />
            ))}
          </ol>
          <div className="aa-audit__foot">
            <span className="aa-muted">
              Showing {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, entries.length)} of{' '}
              {entries.length} events
            </span>
            {pageCount > 1 && (
              <div className="aa-pager">
                <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  ‹
                </button>
                <span className="aa-pager__at">
                  {current}/{pageCount}
                </span>
                <button
                  type="button"
                  disabled={current >= pageCount}
                  onClick={() => setPage(current + 1)}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const summary = payloadSummary(entry.payload);
  const provenance = provenanceOf(entry);
  return (
    <li className="aa-tl">
      <span className="aa-tl__dot" aria-hidden="true" />
      <div className="aa-tl__body">
        <div className="aa-tl__row">
          <strong>{kindLabel(entry.kind)}</strong>
          <span className="aa-tl__time aa-muted">{stamp(entry.at)}</span>
        </div>
        <span className={`aa-kind aa-kind--${toneForKind(entry.kind)}`}>
          {entry.kind.replace(/\./g, '_').toUpperCase()}
        </span>
        {summary !== '' && <p className="aa-tl__detail">{summary}</p>}
        <p className="aa-tl__meta aa-muted">
          {entry.actor ?? 'System'}
          {provenance !== null && <> · {provenance}</>}
        </p>
      </div>
    </li>
  );
}

function toneForKind(kind: string): Tone {
  if (kind === 'recommendation.accepted' || kind === 'containment.approved') return 'ok';
  if (kind === 'recommendation.rejected' || kind === 'containment.rejected') return 'critical';
  if (kind === 'containment.proposed') return 'warn';
  return 'neutral';
}

/** For AI-recommendation entries, the reasoning version + grounding hash carried in the payload. */
function provenanceOf(entry: AuditEntry): string | null {
  if (!entry.kind.startsWith('recommendation.')) return null;
  const p = entry.payload as Record<string, unknown> | null;
  if (p === null || typeof p !== 'object') return null;
  const version = typeof p['reasoningVersion'] === 'string' ? p['reasoningVersion'] : null;
  const hash = typeof p['groundingHash'] === 'string' ? p['groundingHash'].slice(0, 8) : null;
  if (version === null && hash === null) return null;
  return [version, hash].filter((v) => v !== null).join(' · ');
}
