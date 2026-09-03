import { useMemo, useState } from 'react';
import {
  MagnifyingGlass,
  CheckCircle,
  Warning,
  ArrowsLeftRight,
  SealCheck,
  FileText,
  Play,
  Pause,
  ShieldSlash,
  Code,
  DownloadSimple,
  ArrowRight,
  CalendarBlank,
  Funnel,
  User,
  CaretDown,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { AuditEntry, AuditVerifyResponse } from '@sentinel/contracts';
import { auditListResponseSchema, auditVerifyResponseSchema } from '@sentinel/contracts';
import { kindLabel, reasonText } from '../incidents/audit-words.js';
import { AuditDrawer } from './AuditDrawer.js';
import './AuditPage.css';

const PAGE_SIZE = 25;

const fmtDateGroup = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtTimeOnly = (ms: number): string =>
  new Date(ms)
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    .toLowerCase();

function getActorInitials(actor?: string | null): string {
  if (!actor || actor === 'system') return 'SY';
  const parts = actor.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1] && parts[0][0] && parts[1][0]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return actor.slice(0, 2).toUpperCase();
}

function getEventIcon(kind: string): { icon: React.JSX.Element; styleClass: string } {
  if (kind.startsWith('incident')) {
    return { icon: <ArrowsLeftRight size={14} />, styleClass: 'aud-plate--purple' };
  }
  if (kind.startsWith('policy.submit') || kind.startsWith('policy.publish')) {
    return { icon: <SealCheck size={14} />, styleClass: 'aud-plate--blue' };
  }
  if (kind.startsWith('policy.draft')) {
    return { icon: <FileText size={14} />, styleClass: 'aud-plate--blue-light' };
  }
  if (kind.includes('resume') || kind.includes('start') || kind.includes('activate')) {
    return { icon: <Play size={14} />, styleClass: 'aud-plate--green' };
  }
  if (kind.includes('pause') || kind.includes('stop')) {
    return { icon: <Pause size={14} />, styleClass: 'aud-plate--amber' };
  }
  return { icon: <ShieldSlash size={14} />, styleClass: 'aud-plate--red' };
}

interface Filters {
  range: 'all' | '24h' | '7d' | '30d';
  type: string;
  actor: string;
  search: string;
}

const INITIAL_FILTERS: Filters = { range: 'all', type: 'all', actor: 'all', search: '' };

async function fetchAuditEntries(): Promise<AuditEntry[]> {
  const response = await fetch('/api/audit?limit=200', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditListResponseSchema.parse(await response.json()).entries;
}

async function fetchVerify(): Promise<AuditVerifyResponse> {
  const response = await fetch('/api/audit/verify', { method: 'POST', credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditVerifyResponseSchema.parse(await response.json());
}

function exportCsv(entries: AuditEntry[]): void {
  const headers = [
    'Seq',
    'Time',
    'Kind',
    'Subject Type',
    'Subject ID',
    'Actor',
    'Hash',
    'Prev Hash',
  ];
  const lines = [headers.join(',')];
  for (const e of entries) {
    const row = [
      e.seq,
      `"${new Date(e.at).toISOString()}"`,
      `"${e.kind}"`,
      `"${e.subjectType}"`,
      `"${e.subjectId}"`,
      `"${e.actor ?? 'system'}"`,
      `"${e.hash}"`,
      `"${e.prevHash}"`,
    ];
    lines.push(row.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sentinel-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditPage(): React.JSX.Element {
  const entriesQuery = useQuery({ queryKey: ['audit-entries'], queryFn: fetchAuditEntries });
  const verify = useQuery({ queryKey: ['audit-verify'], queryFn: fetchVerify });

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [showTechnical, setShowTechnical] = useState(false);

  const all = entriesQuery.data ?? [];

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      filters.range === '24h'
        ? 24 * 60 * 60 * 1000
        : filters.range === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : filters.range === '30d'
            ? 30 * 24 * 60 * 60 * 1000
            : null;

    const term = filters.search.trim().toLowerCase();

    return all.filter((entry) => {
      if (rangeMs !== null && now - entry.at > rangeMs) return false;
      if (filters.type !== 'all' && entry.kind !== filters.type) return false;
      if (filters.actor !== 'all' && (entry.actor ?? 'system') !== filters.actor) return false;
      if (term.length > 0) {
        const text =
          `${entry.seq} ${entry.kind} ${kindLabel(entry.kind)} ${entry.actor ?? 'system'} ${entry.hash} ${JSON.stringify(entry.payload)}`.toLowerCase();
        if (!text.includes(term)) return false;
      }
      return true;
    });
  }, [all, filters]);

  const seqToHash = useMemo(() => new Map(all.map((entry) => [entry.seq, entry.hash])), [all]);
  const selected = useMemo(
    () => all.find((entry) => entry.seq === selectedSeq) ?? null,
    [all, selectedSeq],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const rows = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  const set = (patch: Partial<Filters>): void => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  return (
    <div className="aud">
      <AuditHeader pending={verify.isPending} error={verify.isError} result={verify.data} />

      <section className="aud-card">
        <Toolbar
          filters={filters}
          entries={all}
          onChange={set}
          onExport={() => exportCsv(filtered)}
          showTechnical={showTechnical}
          onToggleTechnical={() => setShowTechnical((v) => !v)}
        />
        <AuditTable
          rows={rows}
          selectedSeq={selectedSeq}
          onSelect={setSelectedSeq}
          loading={entriesQuery.isPending}
          error={entriesQuery.isError ? entriesQuery.error.message : null}
          onRetry={() => void entriesQuery.refetch()}
          filteredEmpty={!entriesQuery.isPending && filtered.length === 0 && all.length > 0}
          totalEmpty={!entriesQuery.isPending && all.length === 0}
          showTechnical={showTechnical}
        />
        {filtered.length > 0 && (
          <Pagination
            page={clampedPage}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </section>

      {selected !== null && (
        <AuditDrawer
          entry={selected}
          nextHash={seqToHash.get(selected.seq + 1) ?? null}
          onClose={() => setSelectedSeq(null)}
        />
      )}
    </div>
  );
}

function AuditHeader({
  pending,
  error,
  result,
}: {
  pending: boolean;
  error: boolean;
  result: AuditVerifyResponse | undefined;
}): React.JSX.Element {
  return (
    <header className="aud-head">
      <div className="aud-head__title">
        <h1>Audit trail</h1>
        <TamperBadge pending={pending} error={error} result={result} />
      </div>
      <p>
        Every decision and every hand that touched one, kept as a tamper-evident record — if a past
        entry were changed, this check would catch it. You can also verify from the command line:{' '}
        <code>pnpm audit:verify</code>.
      </p>
    </header>
  );
}

function TamperBadge({
  pending,
  error,
  result,
}: {
  pending: boolean;
  error: boolean;
  result: AuditVerifyResponse | undefined;
}): React.JSX.Element {
  if (pending) return <span className="aud-tamper aud-tamper--pending">Checking record…</span>;
  if (error || result === undefined) {
    return <span className="aud-tamper aud-tamper--warn">Not verified</span>;
  }
  if (result.valid) {
    return (
      <span
        className="aud-tamper aud-tamper--ok"
        title={`All ${result.entries} ${result.entries === 1 ? 'entry is' : 'entries are'} linked correctly`}
      >
        <CheckCircle size={14} /> Tamper-checked
      </span>
    );
  }
  const d = result.firstDivergence;
  return (
    <span className="aud-tamper aud-tamper--bad" role="alert">
      <Warning size={14} /> Record altered at entry {d?.seq} —{' '}
      {d !== null ? reasonText(d.reason) : 'the chain did not verify'}
    </span>
  );
}

function Toolbar({
  filters,
  entries,
  onChange,
  onExport,
  showTechnical,
  onToggleTechnical,
}: {
  filters: Filters;
  entries: AuditEntry[];
  onChange: (patch: Partial<Filters>) => void;
  onExport: () => void;
  showTechnical: boolean;
  onToggleTechnical: () => void;
}): React.JSX.Element {
  const types = useMemo(() => [...new Set(entries.map((entry) => entry.kind))].sort(), [entries]);
  const actors = useMemo(
    () => [...new Set(entries.map((entry) => entry.actor ?? 'system'))].sort(),
    [entries],
  );

  return (
    <div className="aud-tools">
      <label className="aud-search">
        <MagnifyingGlass size={15} className="aud-search__icon" />
        <input
          type="search"
          placeholder="Search events, details, or hash…"
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          aria-label="Search audit events"
        />
      </label>

      {/* Date filter pill */}
      <div className="aud-pill-select">
        <CalendarBlank size={14} />
        <select
          value={filters.range}
          onChange={(e) => onChange({ range: e.target.value as Filters['range'] })}
          aria-label="Date range"
        >
          <option value="all">All time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <CaretDown size={12} className="aud-pill-caret" />
      </div>

      {/* Event type filter pill */}
      <div className="aud-pill-select">
        <Funnel size={14} />
        <select
          value={filters.type}
          onChange={(e) => onChange({ type: e.target.value })}
          aria-label="Event type"
        >
          <option value="all">All event types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {kindLabel(type)}
            </option>
          ))}
        </select>
        <CaretDown size={12} className="aud-pill-caret" />
      </div>

      {/* User filter pill */}
      <div className="aud-pill-select">
        <User size={14} />
        <select
          value={filters.actor}
          onChange={(e) => onChange({ actor: e.target.value })}
          aria-label="User"
        >
          <option value="all">All users</option>
          {actors.map((actor) => (
            <option key={actor} value={actor}>
              {actor}
            </option>
          ))}
        </select>
        <CaretDown size={12} className="aud-pill-caret" />
      </div>

      <button
        type="button"
        className={`aud-btn-pill${showTechnical ? ' is-active' : ''}`}
        onClick={onToggleTechnical}
        aria-pressed={showTechnical}
      >
        <Code size={14} /> Technical details
      </button>

      <button
        type="button"
        className="aud-btn-pill"
        onClick={onExport}
        disabled={entries.length === 0}
      >
        <DownloadSimple size={14} /> Export CSV
      </button>
    </div>
  );
}

function AuditRows({
  rows,
  selectedSeq,
  onSelect,
  showTechnical,
}: {
  rows: AuditEntry[];
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
  showTechnical: boolean;
}): React.JSX.Element {
  // Group rows by date
  const grouped = useMemo(() => {
    const groups: { dateStr: string; entries: AuditEntry[] }[] = [];
    for (const entry of rows) {
      const dateStr = fmtDateGroup(entry.at);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.dateStr === dateStr) {
        lastGroup.entries.push(entry);
      } else {
        groups.push({ dateStr, entries: [entry] });
      }
    }
    return groups;
  }, [rows]);

  return (
    <div className="aud-table__wrap">
      <table className="aud-table" role="table">
        <thead>
          <tr role="row">
            <th role="columnheader">Chain</th>
            <th role="columnheader">Event</th>
            <th role="columnheader">Time</th>
            <th role="columnheader">By</th>
            {showTechnical && <th role="columnheader">Hash</th>}
            <th role="columnheader" className="aud-table__view-head">
              View
            </th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((group) => (
            <ReactGroup
              key={group.dateStr}
              group={group}
              selectedSeq={selectedSeq}
              onSelect={onSelect}
              showTechnical={showTechnical}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReactGroup({
  group,
  selectedSeq,
  onSelect,
  showTechnical,
}: {
  group: { dateStr: string; entries: AuditEntry[] };
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
  showTechnical: boolean;
}): React.JSX.Element {
  const colSpan = showTechnical ? 6 : 5;
  return (
    <>
      <tr className="aud-date-row" role="row">
        <td colSpan={colSpan} role="cell">
          <div className="aud-date-divider">
            <span className="aud-date-title">{group.dateStr}</span>
            <span className="aud-date-count">
              {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </td>
      </tr>
      {group.entries.map((entry) => {
        const { icon, styleClass } = getEventIcon(entry.kind);
        const initials = getActorInitials(entry.actor);
        return (
          <tr
            key={entry.seq}
            className={`aud-row${entry.seq === selectedSeq ? ' is-selected' : ''}`}
            onClick={() => onSelect(entry.seq)}
            tabIndex={0}
            role="row"
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelect(entry.seq);
            }}
          >
            <td className="aud-seq" role="cell">
              <div className="aud-chain-cell">
                <span className="aud-chain-line" />
                <span className="aud-chain-dot">{entry.seq}</span>
              </div>
            </td>
            <td className="aud-event" role="cell">
              <div className="aud-event-cell">
                <span className={`aud-plate ${styleClass}`}>{icon}</span>
                <span className="aud-event-label">{kindLabel(entry.kind)}</span>
              </div>
            </td>
            <td className="aud-when" role="cell">
              {fmtTimeOnly(entry.at)}
            </td>
            <td className="aud-by" role="cell">
              <div className="aud-actor-cell">
                <span className={`aud-avatar aud-avatar--${initials.toLowerCase()}`}>
                  {initials}
                </span>
                <span className="aud-actor-name">{entry.actor ?? 'system'}</span>
              </div>
            </td>
            {showTechnical && (
              <td role="cell">
                <code className="aud-hash">{entry.hash.slice(0, 12)}…</code>
              </td>
            )}
            <td className="aud-table__view" role="cell">
              <ArrowRight size={14} className="aud-view-arrow" />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function AuditTable({
  rows,
  selectedSeq,
  onSelect,
  loading,
  error,
  onRetry,
  filteredEmpty,
  totalEmpty,
  showTechnical,
}: {
  rows: AuditEntry[];
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  filteredEmpty: boolean;
  totalEmpty: boolean;
  showTechnical: boolean;
}): React.JSX.Element {
  if (error !== null) {
    return (
      <div className="aud-state" role="alert">
        <p>Unable to load audit events. {error}</p>
        <button type="button" className="aud-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (loading) return <TableSkeleton />;
  if (totalEmpty)
    return (
      <div className="aud-state">
        Nothing recorded yet. Move an incident or take an action, and it appears here, chained.
      </div>
    );
  if (filteredEmpty)
    return (
      <div className="aud-state">
        <strong>No audit events found.</strong>
        <span>Try widening the date range, clearing the filters, or a different search term.</span>
      </div>
    );

  return (
    <AuditRows
      rows={rows}
      selectedSeq={selectedSeq}
      onSelect={onSelect}
      showTechnical={showTechnical}
    />
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}): React.JSX.Element {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="aud-foot">
      <span className="aud-foot__count">
        Showing <strong className="aud-foot__strong">{from}</strong> to{' '}
        <strong className="aud-foot__strong">{to}</strong> of {total} entries
      </span>
      {totalPages > 1 && (
        <div className="aud-pager">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          {pagesToShow(page, totalPages).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} className="aud-pager__gap">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                className={entry === page ? 'is-active' : undefined}
                onClick={() => onPage(entry)}
              >
                {entry}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
      <span className="aud-foot__append-note">
        Entries are append‑only — nothing here can be edited or removed
      </span>
    </div>
  );
}

function pagesToShow(page: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    if (index > 0 && sorted[index]! - sorted[index - 1]! > 1) out.push(null);
    out.push(sorted[index]!);
  }
  return out;
}

function TableSkeleton(): React.JSX.Element {
  return (
    <div className="aud-skel" aria-hidden="true">
      <div className="aud-skel__row" />
      <div className="aud-skel__row" />
      <div className="aud-skel__row" />
    </div>
  );
}
