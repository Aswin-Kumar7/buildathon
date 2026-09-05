import { useState } from 'react';
import { Scroll, ClockCounterClockwise, ArrowBendUpRight } from '@phosphor-icons/react';
import type { AuditEntry, ContainmentDto, IncidentDetail } from '@sentinel/contracts';
import { kindLabel, payloadSummary } from '../incidents/audit-words.js';
import type { QueryState } from './IncidentActionsAudit.js';

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
      if (ev.kind === 'activated') return;
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
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
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
          <ClockCounterClockwise size={16} color="oklch(0.46 0.12 258)" />
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
            Action history
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            Actions taken on this incident.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            padding: '16px 20px',
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          No actions taken yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Header Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 1fr) 110px 104px 84px 96px',
              gap: '12px',
              padding: '10px 20px',
              background: 'oklch(0.984 0.003 270)',
              borderBottom: '1px solid oklch(0.955 0.006 280)',
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            <span>ACTION</span>
            <span>TYPE</span>
            <span>STATUS</span>
            <span>BY</span>
            <span style={{ textAlign: 'right' }}>AT</span>
          </div>

          {/* Rows */}
          {rows.map((row, index) => (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 1fr) 110px 104px 84px 96px',
                gap: '12px',
                alignItems: 'center',
                padding: '12px 20px',
                ...(index < rows.length - 1 && {
                  borderBottom: '1px solid oklch(0.968 0.006 280)',
                }),
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
                {row.action}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'oklch(0.48 0.015 280)' }}>
                {row.type}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 'fit-content',
                  padding: '3px 10px',
                  borderRadius: 'var(--s-radius-pill)',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  color:
                    row.tone === 'ok'
                      ? 'oklch(0.4 0.11 162)'
                      : row.tone === 'critical'
                        ? 'oklch(0.48 0.15 22)'
                        : row.tone === 'warn'
                          ? 'oklch(0.45 0.12 70)'
                          : 'oklch(0.44 0.015 280)',
                  background:
                    row.tone === 'ok'
                      ? 'oklch(0.955 0.03 162)'
                      : row.tone === 'critical'
                        ? 'oklch(0.958 0.026 22)'
                        : row.tone === 'warn'
                          ? 'oklch(0.965 0.03 70)'
                          : 'oklch(0.958 0.006 280)',
                }}
              >
                {row.status}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'oklch(0.48 0.015 280)' }}>
                {row.by}
              </span>
              <span
                style={{
                  textAlign: 'right',
                  fontSize: '11.5px',
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'oklch(0.52 0.015 280)',
                }}
              >
                {stamp(row.at)}
              </span>
            </div>
          ))}
        </div>
      )}
      {resolvable && (
        <ResolveFooter onResolve={onResolve} pending={resolvePending} error={resolveError} />
      )}
    </section>
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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '14px 20px',
        background: 'oklch(0.985 0.003 270)',
        borderTop: '1px solid oklch(0.955 0.006 280)',
      }}
    >
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'oklch(0.5 0.015 280)' }}>
        Close this incident with your verdict:
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          disabled={pending}
          onClick={() => onResolve('confirmed_abuse')}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid oklch(0.925 0.006 280)',
            background: 'oklch(1 0 0)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'oklch(0.48 0.15 22)',
            cursor: 'pointer',
          }}
        >
          Confirmed abuse
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onResolve('false_positive')}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid oklch(0.925 0.006 280)',
            background: 'oklch(1 0 0)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'oklch(0.4 0.11 162)',
            cursor: 'pointer',
          }}
        >
          False positive
        </button>
      </div>
      {error !== null && (
        <p style={{ margin: 0, fontSize: '12px', color: 'oklch(0.48 0.15 22)' }} role="alert">
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
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
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
          <Scroll size={16} color="oklch(0.46 0.12 258)" />
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
            Audit log
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            All changes and events related to this incident.
          </p>
        </div>
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
          Loading the audit log…
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
          The audit log could not be loaded.
        </p>
      )}
      {state === 'ready' && entries.length === 0 && (
        <p
          style={{
            padding: '16px 20px',
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          Nothing has been recorded against this incident yet.
        </p>
      )}
      {state === 'ready' && entries.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {shown.map((entry) => (
              <AuditRow key={entry.seq} entry={entry} />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              background: 'oklch(0.985 0.003 270)',
              borderTop: '1px solid oklch(0.955 0.006 280)',
              fontSize: '11.5px',
              fontWeight: 500,
              color: 'oklch(0.58 0.015 280)',
            }}
          >
            <span>
              Showing {(current - 1) * PAGE + 1}–{Math.min(current * PAGE, entries.length)} of{' '}
              {entries.length} events
            </span>
            {pageCount > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                  style={{
                    border: '1px solid oklch(0.925 0.006 280)',
                    background: 'oklch(1 0 0)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    cursor: current <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ‹
                </button>
                <span>
                  {current}/{pageCount}
                </span>
                <button
                  type="button"
                  disabled={current >= pageCount}
                  onClick={() => setPage(current + 1)}
                  style={{
                    border: '1px solid oklch(0.925 0.006 280)',
                    background: 'oklch(1 0 0)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    cursor: current >= pageCount ? 'not-allowed' : 'pointer',
                  }}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const summary = payloadSummary(entry.payload);
  const prov = provenanceOf(entry);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px 20px',
        borderBottom: '1px solid oklch(0.968 0.006 280)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'oklch(0.24 0.015 280)',
          }}
        >
          <ArrowBendUpRight size={15} color="oklch(0.46 0.12 258)" />
          {kindLabel(entry.kind)}
        </span>
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 500,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.58 0.015 280)',
          }}
        >
          {stamp(entry.at)}
        </span>
      </div>
      <span
        style={{
          padding: '2px 8px',
          width: 'fit-content',
          borderRadius: '5px',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '10.5px',
          fontWeight: 500,
          color: 'oklch(0.46 0.015 280)',
          background: 'oklch(0.962 0.004 270)',
        }}
      >
        {entry.kind.replace(/\./g, '_').toUpperCase()}
      </span>
      {summary !== '' && (
        <p
          style={{
            margin: 0,
            fontSize: '12.5px',
            fontWeight: 500,
            lineHeight: 1.6,
            color: 'oklch(0.44 0.015 280)',
            textWrap: 'pretty',
          }}
        >
          {summary}
        </p>
      )}
      <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'oklch(0.6 0.015 280)' }}>
        {entry.actor ?? 'System'}
        {prov !== null && <> · {prov}</>}
      </span>
    </div>
  );
}

function provenanceOf(entry: AuditEntry): string | null {
  if (!entry.kind.startsWith('recommendation.')) return null;
  const p = entry.payload as Record<string, unknown> | null;
  if (p === null || typeof p !== 'object') return null;
  const version = typeof p['reasoningVersion'] === 'string' ? p['reasoningVersion'] : null;
  const hash = typeof p['groundingHash'] === 'string' ? p['groundingHash'].slice(0, 8) : null;
  if (version === null && hash === null) return null;
  return [version, hash].filter((v) => v !== null).join(' · ');
}
