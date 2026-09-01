import { useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EmptyState, ErrorState, Loading } from '@sentinel/ui';
import {
  attemptRowsResponseSchema,
  type AttemptRow,
  type AttemptRowsResponse,
} from '@sentinel/contracts';

import visaLogo from '../assets/payments/visa.png';
import mastercardLogo from '../assets/payments/mastercard.svg';
import rupayLogo from '../assets/payments/rupay.png';
import amexLogo from '../assets/payments/amex.svg';
import upiLogo from '../assets/payments/upi.svg';
import netbankingLogo from '../assets/payments/netbanking.svg';
import walletLogo from '../assets/payments/wallet.png';

import './AttemptsPage.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import {
  CreditCard,
  Check,
  X,
  ArrowsClockwise,
  Shield,
  Calendar,
  MagnifyingGlass,
  CaretDown,
} from '@phosphor-icons/react';

type Source = 'all' | 'razorpay' | 'replay';

async function fetchRows(params: {
  source: Source;
  status: string;
  method: string;
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

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_TONE: Record<AttemptRow['status'], string> = {
  captured: 'ok',
  recovered: 'info',
  failed: 'critical',
  authorized: 'warn',
  refunded: 'warn',
  pending: 'neutral',
};

const STATUS_LABEL: Record<AttemptRow['status'], string> = {
  captured: 'Captured',
  recovered: 'Recovered',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  pending: 'Pending',
};

const STATUS_OPTIONS = [
  ['all', 'All'],
  ['captured', 'Captured'],
  ['failed', 'Failed'],
  ['recovered', 'Recovered'],
  ['authorized', 'Authorized'],
  ['refunded', 'Refunded'],
  ['pending', 'Pending'],
] as const;

const METHOD_OPTIONS = [
  ['all', 'All'],
  ['card', 'Card'],
  ['upi', 'UPI'],
  ['netbanking', 'Netbanking'],
  ['wallet', 'Wallet'],
] as const;

const RISK_LEVEL_OPTIONS = [
  ['all', 'All'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
] as const;

const CARD_BRANDS: Record<string, { logo: string; cls: string; label: string }> = {
  visa: { logo: visaLogo, cls: 'ap-pm-logo--visa', label: 'Visa' },
  mastercard: { logo: mastercardLogo, cls: 'ap-pm-logo--mastercard', label: 'Mastercard' },
  rupay: { logo: rupayLogo, cls: 'ap-pm-logo--rupay', label: 'RuPay' },
  amex: { logo: amexLogo, cls: 'ap-pm-logo--amex', label: 'Amex' },
};

function PaymentMethodCell({ row }: { row: AttemptRow }): React.JSX.Element {
  const method = row.method?.toLowerCase();
  const network = row.cardNetwork?.toLowerCase();

  const preventSave = (e: React.MouseEvent) => e.preventDefault();

  if (method === 'upi') {
    return (
      <div className="ap-pm-cell">
        <div className="ap-pm-logo-wrap">
          <img
            src={upiLogo}
            alt=""
            className="ap-pm-logo ap-pm-logo--upi"
            draggable={false}
            onContextMenu={preventSave}
          />
        </div>
        <span>UPI</span>
      </div>
    );
  }

  if (method === 'netbanking') {
    return (
      <div className="ap-pm-cell">
        <div className="ap-pm-logo-wrap">
          <img
            src={netbankingLogo}
            alt=""
            className="ap-pm-logo ap-pm-logo--netbanking"
            draggable={false}
            onContextMenu={preventSave}
          />
        </div>
        <span>Netbanking</span>
      </div>
    );
  }

  if (method === 'wallet') {
    return (
      <div className="ap-pm-cell">
        <div className="ap-pm-logo-wrap">
          <img
            src={walletLogo}
            alt=""
            className="ap-pm-logo ap-pm-logo--wallet"
            draggable={false}
            onContextMenu={preventSave}
          />
        </div>
        <span>Wallet</span>
      </div>
    );
  }

  // Card payment: show the real network Razorpay reported. Never an invented brand or card number —
  // the system deliberately stores neither, so an unknown network reads as a plain "Card".
  const brand = network === undefined ? undefined : CARD_BRANDS[network];
  if (brand === undefined) {
    return (
      <div className="ap-pm-cell">
        <div className="ap-pm-logo-wrap ap-pm-logo-wrap--generic">
          <CreditCard />
        </div>
        <span>Card</span>
      </div>
    );
  }

  return (
    <div className="ap-pm-cell">
      <div className="ap-pm-logo-wrap">
        <img
          src={brand.logo}
          alt=""
          className={`ap-pm-logo ${brand.cls}`}
          draggable={false}
          onContextMenu={preventSave}
        />
      </div>
      <span>{brand.label}</span>
    </div>
  );
}

function Kpis({ kpis }: { kpis: AttemptRowsResponse['kpis'] }): React.JSX.Element {
  const formatShare = (part: number): string =>
    kpis.total === 0 ? '0.0% of total' : `${((part / kpis.total) * 100).toFixed(1)}% of total`;

  const safeAttempts = Math.max(0, kpis.total - kpis.inIncident);
  const safeShare = formatShare(safeAttempts);
  // A real, computed figure from the counts we hold — never a fabricated "vs yesterday" delta.
  const approvalRate =
    kpis.total === 0 ? '0.0%' : `${((kpis.captured / kpis.total) * 100).toFixed(1)}%`;

  return (
    <div className="ap-kpis">
      <article className="ap-kpi ap-kpi--total">
        <span className="ap-kpi__icon ap-kpi__icon--card" aria-hidden="true">
          <CreditCard />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Total attempts</span>
          <strong className="ap-kpi__value">{kpis.total.toLocaleString('en-IN')}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--blue">{approvalRate} approved</span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--captured">
        <span className="ap-kpi__icon ap-kpi__icon--check" aria-hidden="true">
          <Check color="#16a34a" />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Captured</span>
          <strong className="ap-kpi__value">{kpis.captured.toLocaleString('en-IN')}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--blue">
            {formatShare(kpis.captured)}
          </span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--failed">
        <span className="ap-kpi__icon ap-kpi__icon--x" aria-hidden="true">
          <X color="#dc2626" />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Failed</span>
          <strong className="ap-kpi__value">{kpis.failed.toLocaleString('en-IN')}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--slate">{formatShare(kpis.failed)}</span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--recovered">
        <span className="ap-kpi__icon ap-kpi__icon--refresh" aria-hidden="true">
          <ArrowsClockwise />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Recovered</span>
          <strong className="ap-kpi__value">{kpis.recovered.toLocaleString('en-IN')}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--purple">
            {formatShare(kpis.recovered)}
          </span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--safe">
        <span className="ap-kpi__icon ap-kpi__icon--shield" aria-hidden="true">
          <Shield color="#16a34a" />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Safe attempts</span>
          <strong className="ap-kpi__value">{safeAttempts.toLocaleString('en-IN')}</strong>
          <div className="ap-kpi__subrow">
            <span className="ap-kpi__subtext ap-kpi__subtext--green">{safeShare}</span>
            <span className="ap-kpi__incident-meta" style={{ display: 'none' }}>
              <span className="ap-kpi__incident-label">In an incident</span>: {kpis.inIncident}
            </span>
          </div>
        </div>
      </article>
    </div>
  );
}

function DateRangePopover({
  customStart,
  customEnd,
  onPreset,
  onCustomStart,
  onCustomEnd,
  onApplyCustom,
}: {
  customStart: string;
  customEnd: string;
  onPreset: (days: number | null) => void;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
  onApplyCustom: () => void;
}): React.JSX.Element {
  return (
    <div className="ap-date-popover">
      <div className="ap-date-presets">
        <button type="button" onClick={() => onPreset(null)}>
          All Time
        </button>
        <button type="button" onClick={() => onPreset(7)}>
          Last 7 Days
        </button>
        <button type="button" onClick={() => onPreset(30)}>
          Last 30 Days
        </button>
        <button type="button" onClick={() => onPreset(90)}>
          Last 90 Days
        </button>
      </div>
      <div className="ap-date-custom">
        <span className="ap-date-custom__title">Custom Range</span>
        <div className="ap-date-custom__inputs">
          <label>
            <span>From</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => onCustomStart(e.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={customEnd} onChange={(e) => onCustomEnd(e.target.value)} />
          </label>
        </div>
        <button type="button" className="ap-date-apply-btn" onClick={onApplyCustom}>
          Apply Range
        </button>
      </div>
    </div>
  );
}

function DateRangePicker({
  startDate,
  endDate,
  onRangeChange,
}: {
  startDate: string;
  endDate: string;
  onRangeChange: (start: string, end: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);

  const displayLabel =
    !startDate && !endDate
      ? 'All Dates'
      : `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;

  const applyPreset = (days: number | null) => {
    if (days === null) {
      onRangeChange('', '');
    } else {
      const now = new Date();
      const past = new Date();
      past.setDate(now.getDate() - days);
      const startStr = past.toISOString().split('T')[0]!;
      const endStr = now.toISOString().split('T')[0]!;
      onRangeChange(startStr, endStr);
    }
    setOpen(false);
  };

  const applyCustom = () => {
    onRangeChange(customStart, customEnd);
    setOpen(false);
  };

  return (
    <div className="ap-date-picker-wrap">
      <button
        type="button"
        className="ap-date-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Select date range"
      >
        <Calendar size={18} />
        <span>{displayLabel}</span>
        <CaretDown size={18} />
      </button>

      {open && (
        <DateRangePopover
          customStart={customStart}
          customEnd={customEnd}
          onPreset={applyPreset}
          onCustomStart={setCustomStart}
          onCustomEnd={setCustomEnd}
          onApplyCustom={applyCustom}
        />
      )}
    </div>
  );
}

function Row({ row }: { row: AttemptRow }): React.JSX.Element {
  return (
    <tr>
      <td className="ap-id ap-id--muted">{row.orderId}</td>
      <td>
        <Link
          className="ap-id ap-id--link"
          to="/console/attempts/$paymentId"
          params={{ paymentId: row.paymentId }}
        >
          {row.paymentId}
        </Link>
      </td>
      <td className="ap-amount">
        {row.amountPaise === null
          ? '-'
          : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
              row.amountPaise / 100,
            )}
      </td>
      <td>
        <PaymentMethodCell row={row} />
      </td>
      <td>
        <span className={`ap-chip ap-chip--${STATUS_TONE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      </td>
      <td>
        {row.incidentId !== null ? (
          <Link
            className="ap-inc"
            to="/console/incidents/$id"
            params={{ id: row.incidentId }}
            title={row.incidentTitle ?? undefined}
          >
            {row.incidentRef}
          </Link>
        ) : (
          <span className="ap-muted">
            <span className="ap-sr-only">Standalone</span>&mdash;
          </span>
        )}
      </td>
      <td className="ap-time">{timeAgo(row.at)}</td>
      <td className="ap-actions">
        <Link
          to="/console/attempts/$paymentId"
          params={{ paymentId: row.paymentId }}
          aria-label={`Open attempt ${row.paymentId}`}
          className="ap-action-chevron"
        >
          &rsaquo;
        </Link>
      </td>
    </tr>
  );
}

function Pager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}): React.JSX.Element {
  const pages = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const shown = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  return (
    <nav className="ap-pager" aria-label="Pagination">
      <button
        type="button"
        className="ap-pager__btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        Prev
      </button>
      {shown.map((p, index) => (
        <span key={p}>
          {index > 0 && p - shown[index - 1]! > 1 && (
            <span className="ap-pager__gap">&hellip;</span>
          )}
          <button
            type="button"
            className={`ap-pager__num${p === page ? ' is-active' : ''}`}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="ap-pager__btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}

interface FilterProps {
  status: string;
  method: string;
  riskLevel: string;
  startDate: string;
  endDate: string;
  search: string;
  setSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onMethod: (value: string) => void;
  onRiskLevel: (value: string) => void;
  onDateRangeChange: (start: string, end: string) => void;
}

function Filters(props: FilterProps): React.JSX.Element {
  return (
    <div className="ap-card-topbar">
      <div className="ap-card-topbar-left">
        <DateRangePicker
          startDate={props.startDate}
          endDate={props.endDate}
          onRangeChange={props.onDateRangeChange}
        />

        <CustomSelectPill
          value={props.status}
          options={STATUS_OPTIONS.map(([id, label]) => ({
            value: id,
            label: id === 'all' ? 'Status: All' : `Status: ${label}`,
          }))}
          onChange={(val) => props.onStatus(val)}
          ariaLabel="Filter status"
        />

        <CustomSelectPill
          value={props.method}
          options={METHOD_OPTIONS.map(([id, label]) => ({
            value: id,
            label: id === 'all' ? 'Method: All' : `Method: ${label}`,
          }))}
          onChange={(val) => props.onMethod(val)}
          ariaLabel="Filter payment method"
        />

        <CustomSelectPill
          value={props.riskLevel}
          options={RISK_LEVEL_OPTIONS.map(([id, label]) => ({
            value: id,
            label: id === 'all' ? 'Risk: All' : `Risk: ${label}`,
          }))}
          onChange={(val) => props.onRiskLevel(val)}
          ariaLabel="Filter risk level"
        />
      </div>

      <div className="ap-card-topbar-right">
        <div className="ap-search-pill">
          <MagnifyingGlass size={18} />
          <input
            type="search"
            value={props.search}
            placeholder="Find attempt..."
            aria-label="Search by Order ID or Payment ID"
            onChange={(e) => props.setSearch(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function ResultsTable({ rows }: { rows: AttemptRow[] }): React.JSX.Element {
  return (
    <div className="ap-table-wrap">
      <table className="ap-table">
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Payment ID</th>
            <th>Amount</th>
            <th>Payment Method</th>
            <th>Status</th>
            <th>Incident</th>
            <th>
              <div className="ap-th-sort">
                <span>Time</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="7 15 12 20 17 15" />
                  <polyline points="7 9 12 4 17 9" />
                </svg>
              </div>
            </th>
            <th>Actions</th>
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
      <span className="ap-panel__summary">
        Showing <strong>{startNum}</strong> to <strong>{endNum}</strong> of{' '}
        <strong>{total.toLocaleString('en-IN')}</strong> total attempts
      </span>
      <div className="ap-foot-controls">
        <div className="ap-rows-per-page">
          <span>Rows per page</span>
          <CustomSelectPill
            value={String(pageSize)}
            options={[
              { value: '10', label: '10' },
              { value: '25', label: '25' },
              { value: '50', label: '50' },
            ]}
            onChange={(val) => onPageSizeChange(Number(val))}
            ariaLabel="Rows per page"
          />
        </div>
        <Pager page={page} pageCount={pageCount} onPage={onPage} />
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

function matchesSearchTerm(row: AttemptRow, term: string): boolean {
  return (
    term === '' ||
    row.paymentId.toLowerCase().includes(term) ||
    row.orderId.toLowerCase().includes(term)
  );
}

function matchesDateRange(row: AttemptRow, startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return true;
  const rowTime = Date.parse(row.at);
  const startTime = Date.parse(`${startDate}T00:00:00Z`);
  const endTime = Date.parse(`${endDate}T23:59:59Z`);
  return rowTime >= startTime && rowTime <= endTime;
}

function matchesMethodFilter(row: AttemptRow, method: string): boolean {
  return (
    method === 'all' || (row.method !== null && row.method.toLowerCase() === method.toLowerCase())
  );
}

function matchesRiskLevel(row: AttemptRow, riskLevel: string): boolean {
  if (riskLevel === 'all') return true;
  if (riskLevel === 'high' || riskLevel === 'medium' || riskLevel === 'critical') {
    return row.incidentId !== null;
  }
  if (riskLevel === 'low') return row.incidentId === null;
  return true;
}

interface RowFilters {
  term: string;
  startDate: string;
  endDate: string;
  status: string;
  method: string;
  riskLevel: string;
}

function rowMatchesFilters(row: AttemptRow, filters: RowFilters): boolean {
  return (
    matchesSearchTerm(row, filters.term) &&
    matchesDateRange(row, filters.startDate, filters.endDate) &&
    (filters.status === 'all' || row.status === filters.status) &&
    matchesMethodFilter(row, filters.method) &&
    matchesRiskLevel(row, filters.riskLevel)
  );
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
      <Kpis kpis={data.kpis} />
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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const attempts = useQuery({
    queryKey: ['attempt-rows', source, status, method, page, pageSize],
    queryFn: () => fetchRows({ source, status, method, page, pageSize }),
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

  const handleDateRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setPage(1);
  };

  const data = attempts.data;
  const term = search.trim().toLowerCase();
  const rows =
    data === undefined
      ? []
      : data.rows.filter((row) =>
          rowMatchesFilters(row, { term, startDate, endDate, status, method, riskLevel }),
        );

  return (
    <div className="ap-page">
      <header className="ap-header-top">
        <div className="ap-header-left">
          <h1>Payment Attempts</h1>
          <p>Every payment attempt received from your storefront.</p>
        </div>
      </header>

      <AttemptsBody
        attempts={attempts}
        rows={rows}
        searching={term !== '' || startDate !== ''}
        pageSize={pageSize}
        onPage={setPage}
        onPageSizeChange={handlePageSizeChange}
        filterProps={{
          status,
          method,
          riskLevel,
          startDate,
          endDate,
          search,
          setSearch,
          onStatus: onFilter(setStatus),
          onMethod: onFilter(setMethod),
          onRiskLevel: onFilter(setRiskLevel),
          onDateRangeChange: handleDateRangeChange,
        }}
      />
    </div>
  );
}
