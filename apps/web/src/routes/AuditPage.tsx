import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  auditListResponseSchema,
  auditVerifyResponseSchema,
  type AuditEntry,
  type AuditVerifyResponse,
} from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';
import {
  fmtDateTime,
  kindLabel,
  kindTone,
  payloadSummary,
  reasonText,
} from '../incidents/audit-words.js';
import { AuditDrawer } from './AuditDrawer.js';
import './AuditPage.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import {
  Check as CheckIcon,
  WarningCircle as AlertIcon,
  MagnifyingGlass as SearchIcon,
  DownloadSimple as ExportIcon,
  ArrowRight as ChevronIcon,
} from '@phosphor-icons/react';

const PAGE_SIZE = 25;

async function fetchEntries(): Promise<AuditEntry[]> {
  const response = await fetch('/api/audit', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditListResponseSchema.parse(await response.json()).entries;
}

async function fetchVerify(): Promise<AuditVerifyResponse> {
  const response = await apiMutate('/api/audit/verify');
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditVerifyResponseSchema.parse(await response.json());
}

interface Filters {
  search: string;
  type: string;
  actor: string;
  range: 'all' | '24h' | '7d' | '30d';
}
const DEFAULTS: Filters = { search: '', type: 'all', actor: 'all', range: 'all' };

const RANGE_MS: Record<Filters['range'], number | null> = {
  all: null,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

function matchesSearch(entry: AuditEntry, term: string): boolean {
  return (
    kindLabel(entry.kind).toLowerCase().includes(term) ||
    (entry.actor ?? 'system').toLowerCase().includes(term) ||
    entry.hash.toLowerCase().includes(term) ||
    entry.subjectId.toLowerCase().includes(term) ||
    payloadSummary(entry.payload).toLowerCase().includes(term)
  );
}

function applyFilters(entries: AuditEntry[], filters: Filters): AuditEntry[] {
  const term = filters.search.trim().toLowerCase();
  const window = RANGE_MS[filters.range];
  const since = window === null ? null : Date.now() - window;
  return entries.filter(
    (entry) =>
      (filters.type === 'all' || entry.kind === filters.type) &&
      (filters.actor === 'all' || (entry.actor ?? 'system') === filters.actor) &&
      (since === null || entry.at >= since) &&
      (term === '' || matchesSearch(entry, term)),
  );
}

export function AuditPage(): React.JSX.Element {
  const entriesQuery = useQuery({
    queryKey: ['audit'],
    queryFn: fetchEntries,
    refetchInterval: 20_000,
  });
  // The chain is verified automatically and shown as a badge — no button to press. The raw hashes and
  // the head are technical detail, tucked behind a toggle so the record reads as a plain history.
  const verify = useQuery({
    queryKey: ['audit-verify'],
    queryFn: fetchVerify,
    refetchInterval: 60_000,
  });

  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [page, setPage] = useState(1);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const all = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const filtered = useMemo(() => applyFilters(all, filters), [all, filters]);
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

/**
 * The tamper check, as a single auto-run badge instead of a button the merchant must press: verified
 * once on load and shown plainly. The raw hashes stay behind the "Technical details" toggle.
 */
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
        <CheckIcon /> Tamper-checked
      </span>
    );
  }
  const d = result.firstDivergence;
  return (
    <span className="aud-tamper aud-tamper--bad" role="alert">
      <AlertIcon /> Record altered at entry {d?.seq} —{' '}
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
        <SearchIcon />
        <input
          type="search"
          placeholder="Search events, details, or hash…"
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          aria-label="Search audit events"
        />
      </label>
      <CustomSelectPill
        value={filters.range}
        options={[
          { value: 'all', label: 'All time' },
          { value: '24h', label: 'Last 24 hours' },
          { value: '7d', label: 'Last 7 days' },
          { value: '30d', label: 'Last 30 days' },
        ]}
        onChange={(val) => onChange({ range: val as Filters['range'] })}
        ariaLabel="Date range"
      />
      <CustomSelectPill
        value={filters.type}
        options={[
          { value: 'all', label: 'All event types' },
          ...types.map((type) => ({ value: type, label: kindLabel(type) })),
        ]}
        onChange={(val) => onChange({ type: val })}
        ariaLabel="Event type"
      />
      <CustomSelectPill
        value={filters.actor}
        options={[
          { value: 'all', label: 'All users' },
          ...actors.map((actor) => ({ value: actor, label: actor })),
        ]}
        onChange={(val) => onChange({ actor: val })}
        ariaLabel="User"
      />
      <button
        type="button"
        className={`aud-export${showTechnical ? ' is-active' : ''}`}
        onClick={onToggleTechnical}
        aria-pressed={showTechnical}
      >
        Technical details
      </button>
      <button
        type="button"
        className="aud-export"
        onClick={onExport}
        disabled={entries.length === 0}
      >
        <ExportIcon /> Export CSV
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
  return (
    <div className="aud-table__wrap">
      <table className="aud-table">
        <thead>
          <tr>
            <th>#</th>
            <th>When</th>
            <th>What</th>
            <th>By</th>
            {showTechnical && <th>Hash</th>}
            <th className="aud-table__view">View</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr
              key={entry.seq}
              className={`aud-row${entry.seq === selectedSeq ? ' is-selected' : ''}`}
              onClick={() => onSelect(entry.seq)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelect(entry.seq);
              }}
            >
              <td className="aud-seq">{entry.seq}</td>
              <td className="aud-when">{fmtDateTime(entry.at)}</td>
              <td>
                <span className={`aud-badge aud-badge--${kindTone(entry.kind)}`}>
                  {kindLabel(entry.kind)}
                </span>
              </td>
              <td className="aud-by">{entry.actor ?? 'system'}</td>
              {showTechnical && (
                <td>
                  <code className="aud-hash">{entry.hash.slice(0, 12)}…</code>
                </td>
              )}
              <td className="aud-table__view">
                <ChevronIcon />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        Showing {from} to {to} of {total} {total === 1 ? 'event' : 'events'}
      </span>
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
    <div className="aud-table__wrap" aria-hidden="true">
      <div className="aud-skel__head" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="aud-skel__row" />
      ))}
    </div>
  );
}

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
function exportCsv(rows: AuditEntry[]): void {
  const header = [
    'seq',
    'when',
    'event',
    'by',
    'hash',
    'prevHash',
    'subjectType',
    'subjectId',
    'detail',
  ];
  const lines = rows.map((entry) =>
    [
      entry.seq,
      new Date(entry.at).toISOString(),
      kindLabel(entry.kind),
      entry.actor ?? 'system',
      entry.hash,
      entry.prevHash,
      entry.subjectType,
      entry.subjectId,
      payloadSummary(entry.payload),
    ]
      .map(csvCell)
      .join(','),
  );
  const url = URL.createObjectURL(
    new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `sentinel-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
