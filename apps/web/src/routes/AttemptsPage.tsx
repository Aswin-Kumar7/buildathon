import { useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EmptyState, ErrorState, Loading } from '@sentinel/ui';
import {
  attemptRowsResponseSchema,
  type AttemptRow,
  type AttemptRowsResponse,
} from '@sentinel/contracts';

import './AttemptsPage.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import { SimulationPopup } from './SimulationPopup.js';
import { SimulationPanel } from './SimulationPanel.js';
import {
  CreditCard,
  Funnel,
  Gauge,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { fetchSimulationStatus as fetchStatus } from '../shared/fetchers.js';
import { PaymentMethodCell } from '../shared/PaymentMethod.js';

type Source = 'all' | 'razorpay' | 'replay';

async function fetchRows(params: {
  source: Source;
  status: string;
  method: string;
  /** Free text over order id, payment id and incident reference. */
  q: string;
  /** Incident severity, or `none` for attempts that belong to no incident. */
  severity: string;
  /** Inclusive `YYYY-MM-DD` lower bound, or '' for no bound. */
  from: string;
  page: number;
  pageSize: number;
}): Promise<AttemptRowsResponse> {
  const query = new URLSearchParams({
    source: params.source,
    status: params.status,
    method: params.method,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  // Omitted rather than sent empty, so the API's own defaults apply.
  if (params.q !== '') query.set('q', params.q);
  if (params.severity !== 'all') query.set('severity', params.severity);
  if (params.from !== '') query.set('from', params.from);
  const response = await fetch(`/api/attempts/rows?${query.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return attemptRowsResponseSchema.parse(await response.json());
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

const STATUS_LABEL: Record<AttemptRow['status'], string> = {
  captured: 'Captured',
  recovered: 'Recovered',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  pending: 'Pending',
};

const STATUS_OPTIONS = [
  ['all', 'Status: all'],
  ['captured', 'Status: Captured'],
  ['failed', 'Status: Failed'],
  ['recovered', 'Status: Recovered'],
  ['authorized', 'Status: Authorized'],
  ['refunded', 'Status: Refunded'],
  ['pending', 'Status: Pending'],
] as const;

const METHOD_OPTIONS = [
  ['all', 'Method: all'],
  ['card', 'Method: Card'],
  ['upi', 'Method: UPI'],
  ['netbanking', 'Method: Netbanking'],
  ['wallet', 'Method: Wallet'],
] as const;

/*
 * The severity of the incident an attempt belongs to. `none` is a real answer, not an absence:
 * an attempt that correlates with nothing is never given a risk score of its own.
 */
const RISK_LEVEL_OPTIONS = [
  ['all', 'Risk: all'],
  ['high', 'Risk: High'],
  ['medium', 'Risk: Medium'],
  ['low', 'Risk: Low'],
  ['none', 'Risk: not in an incident'],
] as const;

/**
 * The four counts, each one a filter.
 *
 * The tiles double as the fastest way to narrow the table — the same affordance the incident queue
 * gives its severity tiles — so "350 failed" is one click away from being the only thing on screen.
 * Clicking the active tile clears it again.
 *
 * The counts are the server's, computed over every attempt in scope rather than the current page,
 * which is why they do not move when you page through the table. Each display status is exclusive:
 * an attempt is counted under exactly one of Captured, Failed and Recovered, so the three shares
 * are directly comparable and never double-count.
 */
interface KpiTile {
  /** The status filter this tile applies; `all` is the "everything" tile. */
  key: 'all' | 'captured' | 'failed' | 'recovered';
  label: string;
  /** What the number actually counts, shown on hover — these are easy to misread otherwise. */
  hint: string;
  value: number;
  tone: string;
}

function Kpis({
  kpis,
  status,
  onStatus,
}: {
  kpis: AttemptRowsResponse['kpis'];
  status: string;
  onStatus: (value: string) => void;
}): React.JSX.Element {
  const share = (part: number): string =>
    kpis.total === 0 ? '0.0% of total' : `${((part / kpis.total) * 100).toFixed(1)}% of total`;
  const pct = (part: number): number =>
    kpis.total === 0 ? 0 : Math.min(100, Math.max(0, (part / kpis.total) * 100));

  const tiles: KpiTile[] = [
    {
      key: 'all',
      label: 'Total attempts',
      hint: 'Every payment attempt in scope. One order can produce several attempts, so this is higher than the number of orders.',
      value: kpis.total,
      tone: 'total',
    },
    {
      key: 'captured',
      label: 'Captured',
      hint: 'Paid on an order that never had a failed attempt — money in, first time.',
      value: kpis.captured,
      tone: 'captured',
    },
    {
      key: 'failed',
      label: 'Failed',
      hint: 'The attempt was declined and did not result in a payment.',
      value: kpis.failed,
      tone: 'failed',
    },
    {
      key: 'recovered',
      label: 'Recovered',
      hint: 'Paid, but only after at least one earlier attempt on the same order had failed — a sale that would have been lost if the shopper had given up. Counted here instead of under Captured, so the two never overlap.',
      value: kpis.recovered,
      tone: 'recovered',
    },
  ];

  return (
    <section className="ap-metrics" aria-label="Attempt outcome summary">
      {tiles.map((tile) => {
        // "Total attempts" is the resting state, not a choice, so it never shows as selected —
        // only a tile that is actually narrowing the table is highlighted.
        const isActive = status === tile.key && tile.key !== 'all';
        const isEmpty = tile.value === 0;
        return (
          <button
            key={tile.key}
            type="button"
            className={`ap-metric-col${isActive ? ' is-active' : ''}`}
            aria-pressed={isActive}
            title={tile.hint}
            // Clicking the tile that is already filtering clears the filter rather than reapplying it.
            onClick={() => onStatus(isActive ? 'all' : tile.key)}
          >
            <div className="ap-metric-col__header">
              <span
                className={`ap-metric-col__dot ${
                  isEmpty && tile.key !== 'all'
                    ? 'ap-metric-col__dot--muted'
                    : `ap-metric-col__dot--${tile.tone}`
                }`}
                aria-hidden="true"
              />
              <span className="ap-metric-col__label">{tile.label}</span>
            </div>
            <div className="ap-metric-col__values">
              <span className={`ap-metric-col__num${isEmpty ? ' ap-metric-col__num--faint' : ''}`}>
                {tile.value.toLocaleString('en-IN')}
              </span>
              <span
                className={`ap-metric-col__share${
                  tile.key === 'all'
                    ? ''
                    : isEmpty
                      ? ' ap-metric-col__share--faint'
                      : ` ap-metric-col__share--${tile.tone}`
                }`}
              >
                {tile.key === 'all' ? (
                  <>
                    {/*
                     * The count is right — it equals the high + medium + low severity totals — but
                     * "screened · In an incident: 271" read as two unrelated labels. Said as a
                     * proportion it is unambiguous.
                     */}
                    <span className="ap-metric-col__share--incident">
                      {kpis.inIncident.toLocaleString('en-IN')}
                    </span>{' '}
                    of these belong to an incident
                  </>
                ) : (
                  share(tile.value)
                )}
              </span>
            </div>
            <div className="ap-metric-col__bar-wrap" aria-hidden="true">
              <div className="ap-metric-col__bar-track">
                <div
                  className={`ap-metric-col__bar-fill ap-metric-col__bar-fill--${tile.tone}`}
                  style={{ width: `${tile.key === 'all' ? 100 : pct(tile.value)}%` }}
                />
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

function Row({ row }: { row: AttemptRow }): React.JSX.Element {
  return (
    <tr className="ap-table-row">
      <td className="ap-td-cell ap-id--order" title={row.orderId}>
        {row.orderId}
      </td>
      <td className="ap-td-cell">
        <Link
          className="ap-id--payment-link"
          to="/console/attempts/$paymentId"
          params={{ paymentId: row.paymentId }}
          title={row.paymentId}
        >
          {row.paymentId}
        </Link>
      </td>
      <td className="ap-td-cell ap-amount-cell">
        {row.amountPaise === null
          ? '-'
          : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
              row.amountPaise / 100,
            )}
      </td>
      <td className="ap-td-cell">
        <PaymentMethodCell method={row.method} cardNetwork={row.cardNetwork} />
      </td>
      <td className="ap-td-cell">
        <span className={`ap-chip ap-chip--${row.status}`}>{STATUS_LABEL[row.status]}</span>
      </td>
      <td className="ap-td-cell">
        {row.incidentId !== null ? (
          <Link
            className="ap-incident-link"
            to="/console/incidents/$id"
            params={{ id: row.incidentId }}
            title={row.incidentTitle ?? undefined}
          >
            {row.incidentRef}
          </Link>
        ) : (
          <span className="ap-incident-standalone">
            <span className="ap-sr-only">Standalone</span>&mdash;
          </span>
        )}
      </td>
      <td className="ap-td-cell ap-time-cell">{timeAgo(row.at)}</td>
      <td className="ap-td-cell ap-action-cell">
        <Link
          to="/console/attempts/$paymentId"
          params={{ paymentId: row.paymentId }}
          aria-label={`Open attempt ${row.paymentId}`}
          className="ap-action-cell"
        >
          <CaretRight size={13} />
        </Link>
      </td>
    </tr>
  );
}

interface FilterProps {
  status: string;
  method: string;
  riskLevel: string;
  dateFilter: string;
  search: string;
  setSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onMethod: (value: string) => void;
  onRiskLevel: (value: string) => void;
  onDateFilterChange: (value: string) => void;
}

function Filters(props: FilterProps): React.JSX.Element {
  return (
    <div className="ap-panel__toolbar">
      <div className="ap-toolbar-filters">
        <CustomSelectPill
          value={props.dateFilter}
          options={DATE_OPTIONS.map((d) => ({
            value: d.value,
            label: d.label,
          }))}
          onChange={(val) => props.onDateFilterChange(val)}
          ariaLabel="Date filter"
          icon={<CalendarBlank size={14} />}
        />

        <CustomSelectPill
          value={props.status}
          options={STATUS_OPTIONS.map(([id, label]) => ({
            value: id,
            label,
          }))}
          onChange={(val) => props.onStatus(val)}
          ariaLabel="Filter status"
          icon={<Funnel size={14} />}
        />

        <CustomSelectPill
          value={props.method}
          options={METHOD_OPTIONS.map(([id, label]) => ({
            value: id,
            label,
          }))}
          onChange={(val) => props.onMethod(val)}
          ariaLabel="Filter payment method"
          icon={<CreditCard size={14} />}
        />

        <CustomSelectPill
          value={props.riskLevel}
          options={RISK_LEVEL_OPTIONS.map(([id, label]) => ({
            value: id,
            label,
          }))}
          onChange={(val) => props.onRiskLevel(val)}
          ariaLabel="Filter risk level"
          icon={<Gauge size={14} />}
        />
      </div>

      <div className="ap-toolbar-search">
        <MagnifyingGlass size={15} />
        <input
          type="search"
          value={props.search}
          placeholder="Find attempt…"
          aria-label="Search by Order ID or Payment ID"
          onChange={(e) => props.setSearch(e.target.value)}
        />
      </div>
    </div>
  );
}

function ResultsTable({ rows }: { rows: AttemptRow[] }): React.JSX.Element {
  return (
    <div className="om-scroll">
      <table className="ap-table" role="table">
        <thead>
          <tr className="ap-table-head-row">
            <th className="ap-th-cell">Order ID</th>
            <th className="ap-th-cell">Payment ID</th>
            <th className="ap-th-cell ap-th-cell--right">Amount</th>
            <th className="ap-th-cell ap-th-cell--method">Method</th>
            <th className="ap-th-cell">Status</th>
            <th className="ap-th-cell">Incident</th>
            <th className="ap-th-cell ap-th-cell--time">Time</th>
            <th className="ap-th-cell" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.paymentId} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsFooter({
  total,
  page,
  pageCount,
  pageSize,
  startNum,
  endNum,
  onPage,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  startNum: number;
  endNum: number;
  onPage: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}): React.JSX.Element {
  return (
    <div className="ap-panel__foot">
      <span className="ap-foot-summary">
        <strong>{total.toLocaleString('en-IN')}</strong> total attempts · showing {startNum}–
        {endNum}
      </span>
      <div className="ap-foot-controls">
        <div className="ap-rows-per-page">
          <CustomSelectPill
            value={String(pageSize)}
            options={[
              { value: '10', label: '10' },
              { value: '15', label: '15' },
              { value: '20', label: '20' },
              { value: '30', label: '30' },
              { value: '50', label: '50' },
            ]}
            direction="up"
            menuMinWidth={72}
            onChange={(val) => onPageSizeChange(Number(val))}
            ariaLabel="Rows per page"
          />
        </div>
        <div className="ap-pager-ctrl">
          <button
            type="button"
            className="ap-pager-btn"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <CaretLeft size={13} />
          </button>
          <span className="ap-pager-page">{page}</span>
          <span className="ap-pager-of">of {pageCount}</span>
          <button
            type="button"
            className="ap-pager-btn"
            onClick={() => onPage(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            <CaretRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Results({
  data,
  rows,
  searching,
  pageSize,
  onPage,
  onPageSizeChange,
  filterProps,
}: {
  data: AttemptRowsResponse;
  rows: AttemptRow[];
  searching: boolean;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  filterProps: FilterProps;
}): React.JSX.Element {
  const pageCount = Math.max(1, Math.ceil(data.total / pageSize));
  const startNum = data.total === 0 ? 0 : (data.page - 1) * pageSize + 1;
  const endNum = Math.min(data.page * pageSize, data.total);

  return (
    <section className="ap-panel">
      <Filters {...filterProps} />

      {data.total === 0 ? (
        <EmptyState
          icon="icon"
          title="No payment attempts yet"
          description={
            data.source === 'razorpay'
              ? 'Complete a storefront checkout and it will appear here. Nothing is invented in the meantime.'
              : 'Run a transaction simulation from the header to populate this view.'
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="search"
          title="No attempts match your search"
          description="Nothing on this page matches that Order or Payment ID or selected filters."
        />
      ) : (
        <ResultsTable rows={rows} />
      )}

      {data.total > 0 && !searching && (
        <ResultsFooter
          total={data.total}
          page={data.page}
          pageCount={pageCount}
          pageSize={pageSize}
          startNum={startNum}
          endNum={endNum}
          onPage={onPage}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </section>
  );
}

/** A `YYYY-MM-DD` lower bound for the relative date choices the toolbar offers. */
function dateFilterFrom(dateFilter: string): string {
  const days =
    dateFilter === 'today' ? 0 : dateFilter === '7d' ? 6 : dateFilter === '30d' ? 29 : -1;
  if (days < 0) return '';
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  // Local midnight, formatted as a local calendar day — toISOString would shift it by the offset.
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

function AttemptsBody({
  attempts,
  rows,
  searching,
  pageSize,
  onPage,
  onPageSizeChange,
  filterProps,
}: {
  attempts: UseQueryResult<AttemptRowsResponse, Error>;
  rows: AttemptRow[];
  searching: boolean;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  filterProps: FilterProps;
}): React.JSX.Element {
  const data = attempts.data;
  return attempts.isPending ? (
    <Loading label="Resolving attempts..." />
  ) : attempts.isError ? (
    <ErrorState message={attempts.error.message} />
  ) : data === undefined ? (
    <ErrorState message="Attempts are unavailable" />
  ) : (
    <>
      {/* The tiles and the Status dropdown drive the same filter, so they always agree. */}
      <Kpis kpis={data.kpis} status={filterProps.status} onStatus={filterProps.onStatus} />
      <Results
        data={data}
        rows={rows}
        searching={searching}
        pageSize={pageSize}
        onPage={onPage}
        onPageSizeChange={onPageSizeChange}
        filterProps={filterProps}
      />
    </>
  );
}

export function AttemptsPage(): React.JSX.Element {
  const [source] = useState<Source>('all');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const [riskLevel, setRiskLevel] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const term = search.trim().toLowerCase();
  const from = dateFilterFrom(dateFilter);

  const [showSimModal, setShowSimModal] = useState(false);
  const [simPanelOpen, setSimPanelOpen] = useState(false);

  const simStatus = useQuery({
    queryKey: ['simulation-status'],
    queryFn: fetchStatus,
    refetchInterval: 2500,
  });

  const attempts = useQuery({
    queryKey: ['attempt-rows', source, status, method, term, riskLevel, from, page, pageSize],
    queryFn: () =>
      fetchRows({ source, status, method, q: term, severity: riskLevel, from, page, pageSize }),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const onFilter =
    <T,>(set: (value: T) => void) =>
    (value: T): void => {
      set(value);
      setPage(1);
    };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  const data = attempts.data;
  // The API filters and pages together, so these rows are already the right ones for this page.
  const rows = data?.rows ?? [];

  const isRunning = simStatus.data?.running ?? false;

  return (
    <div className="ap-page">
      <header className="ap-header-top">
        <div className="ap-header-left">
          <h1>Payment attempts</h1>
          <p>Every payment attempt received from your storefront</p>
        </div>
      </header>

      {showSimModal && (
        <SimulationPopup
          disabled={isRunning}
          onClose={() => setShowSimModal(false)}
          onStarted={() => {
            setShowSimModal(false);
            setSimPanelOpen(true);
            void simStatus.refetch();
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'flex-start',
          width: '100%',
        }}
      >
        <div style={{ flex: simPanelOpen || isRunning ? '1 1 620px' : '1 1 100%', minWidth: 0 }}>
          <AttemptsBody
            attempts={attempts}
            rows={rows}
            searching={term !== '' || dateFilter !== 'all'}
            pageSize={pageSize}
            onPage={setPage}
            onPageSizeChange={handlePageSizeChange}
            filterProps={{
              status,
              method,
              riskLevel,
              dateFilter,
              search,
              setSearch,
              onStatus: onFilter(setStatus),
              onMethod: onFilter(setMethod),
              onRiskLevel: onFilter(setRiskLevel),
              onDateFilterChange: onFilter(setDateFilter),
            }}
          />
        </div>

        {(simPanelOpen || isRunning) && (
          <SimulationPanel
            onClose={() => setSimPanelOpen(false)}
            onTick={() => {
              void attempts.refetch();
            }}
          />
        )}
      </div>
    </div>
  );
}
