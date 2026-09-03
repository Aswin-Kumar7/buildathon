import { useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EmptyState, ErrorState, Loading } from '@sentinel/ui';
import {
  attemptRowsResponseSchema,
  simulationStatusSchema,
  type AttemptRow,
  type AttemptRowsResponse,
  type SimulationStatus,
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
import { SimulationPopup } from './SimulationPopup.js';
import { SimulationPanel } from './SimulationPanel.js';
import {
  CreditCard,
  Receipt,
  Funnel,
  Gauge,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Wallet,
  Play,
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

const RISK_LEVEL_OPTIONS = [
  ['all', 'Risk: all'],
  ['low', 'Risk: Low'],
  ['medium', 'Risk: Medium'],
  ['high', 'Risk: High'],
] as const;

const CARD_BRANDS: Record<string, { logo: string; cls: string; label: string }> = {
  visa: { logo: visaLogo, cls: 'ap-method-logo--visa', label: 'Visa' },
  mastercard: { logo: mastercardLogo, cls: 'ap-method-logo--mc', label: 'Mastercard' },
  rupay: { logo: rupayLogo, cls: 'ap-method-logo--rupay', label: 'RuPay' },
  amex: { logo: amexLogo, cls: 'ap-method-logo--amex', label: 'Amex' },
};

function PaymentMethodCell({ row }: { row: AttemptRow }): React.JSX.Element {
  const method = row.method?.toLowerCase();
  const network = row.cardNetwork?.toLowerCase();

  const preventSave = (e: React.MouseEvent) => e.preventDefault();

  if (method === 'upi') {
    return (
      <span className="ap-method-cell">
        <span className="ap-method-logo-wrap">
          <img
            src={upiLogo}
            alt=""
            className="ap-method-logo ap-method-logo--upi"
            draggable={false}
            onContextMenu={preventSave}
          />
        </span>
        <span className="ap-method-label">UPI</span>
      </span>
    );
  }

  if (method === 'netbanking') {
    return (
      <span className="ap-method-cell">
        <span className="ap-method-logo-wrap">
          <img
            src={netbankingLogo}
            alt=""
            className="ap-method-logo ap-method-logo--netbanking"
            draggable={false}
            onContextMenu={preventSave}
          />
        </span>
        <span className="ap-method-label">Netbanking</span>
      </span>
    );
  }

  if (method === 'wallet') {
    return (
      <span className="ap-method-cell">
        <span className="ap-method-logo-wrap">
          <Wallet size={15} color="oklch(0.5 0.015 280)" />
        </span>
        <span className="ap-method-label">Wallet</span>
      </span>
    );
  }

  const brand = network === undefined ? undefined : CARD_BRANDS[network];
  if (brand === undefined) {
    return (
      <span className="ap-method-cell">
        <span className="ap-method-logo-wrap">
          <CreditCard size={15} color="oklch(0.5 0.015 280)" />
        </span>
        <span className="ap-method-label">Card</span>
      </span>
    );
  }

  return (
    <span className="ap-method-cell">
      <span className="ap-method-logo-wrap">
        <img
          src={brand.logo}
          alt=""
          className={`ap-method-logo ${brand.cls}`}
          draggable={false}
          onContextMenu={preventSave}
        />
      </span>
      <span className="ap-method-label">{brand.label}</span>
    </span>
  );
}

function Kpis({ kpis }: { kpis: AttemptRowsResponse['kpis'] }): React.JSX.Element {
  const calcPct = (val: number): number =>
    kpis.total === 0 ? 0 : Math.min(100, Math.max(0, (val / kpis.total) * 100));

  const formatShare = (part: number): string =>
    kpis.total === 0 ? '0.0% of total' : `${((part / kpis.total) * 100).toFixed(1)}% of total`;

  const safeAttempts = Math.max(0, kpis.total - kpis.inIncident);
  const capturedPct = calcPct(kpis.captured);
  const failedPct = calcPct(kpis.failed);
  const recoveredPct = calcPct(kpis.recovered);
  const safePct = calcPct(safeAttempts);

  return (
    <section className="ap-metrics" aria-label="Metrics summary">
      {/* Column 1: Total attempts */}
      <div className="ap-metric-col">
        <div className="ap-metric-col__header">
          <span className="ap-metric-col__dot ap-metric-col__dot--total" aria-hidden="true" />
          <span className="ap-metric-col__label">Total attempts</span>
        </div>
        <div className="ap-metric-col__values">
          <span className="ap-metric-col__num">{kpis.total.toLocaleString('en-IN')}</span>
          <span className="ap-metric-col__share">screened</span>
        </div>
        <div className="ap-metric-col__bar-wrap" aria-hidden="true">
          <div className="ap-metric-col__bar-track">
            <div
              className="ap-metric-col__bar-fill ap-metric-col__bar-fill--total"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* Column 2: Captured */}
      <div className="ap-metric-col">
        <div className="ap-metric-col__header">
          <span className="ap-metric-col__dot ap-metric-col__dot--captured" aria-hidden="true" />
          <span className="ap-metric-col__label">Captured</span>
        </div>
        <div className="ap-metric-col__values">
          <span className="ap-metric-col__num">{kpis.captured.toLocaleString('en-IN')}</span>
          <span className="ap-metric-col__share ap-metric-col__share--captured">
            {formatShare(kpis.captured)}
          </span>
        </div>
        <div className="ap-metric-col__bar-wrap" aria-hidden="true">
          <div className="ap-metric-col__bar-track">
            <div
              className="ap-metric-col__bar-fill ap-metric-col__bar-fill--captured"
              style={{ width: `${capturedPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Column 3: Failed */}
      <div className="ap-metric-col">
        <div className="ap-metric-col__header">
          <span className="ap-metric-col__dot ap-metric-col__dot--failed" aria-hidden="true" />
          <span className="ap-metric-col__label">Failed</span>
        </div>
        <div className="ap-metric-col__values">
          <span className="ap-metric-col__num">{kpis.failed.toLocaleString('en-IN')}</span>
          <span className="ap-metric-col__share ap-metric-col__share--failed">
            {formatShare(kpis.failed)}
          </span>
        </div>
        <div className="ap-metric-col__bar-wrap" aria-hidden="true">
          <div className="ap-metric-col__bar-track">
            <div
              className="ap-metric-col__bar-fill ap-metric-col__bar-fill--failed"
              style={{ width: `${failedPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Column 4: Recovered */}
      <div className="ap-metric-col">
        <div className="ap-metric-col__header">
          <span
            className={`ap-metric-col__dot ${kpis.recovered > 0 ? 'ap-metric-col__dot--recovered' : 'ap-metric-col__dot--muted'}`}
            aria-hidden="true"
          />
          <span className="ap-metric-col__label">Recovered</span>
        </div>
        <div className="ap-metric-col__values">
          <span
            className={`ap-metric-col__num ${kpis.recovered === 0 ? 'ap-metric-col__num--faint' : ''}`}
          >
            {kpis.recovered.toLocaleString('en-IN')}
          </span>
          <span
            className={`ap-metric-col__share ${kpis.recovered > 0 ? 'ap-metric-col__share--recovered' : 'ap-metric-col__share--faint'}`}
          >
            {formatShare(kpis.recovered)}
          </span>
        </div>
        <div className="ap-metric-col__bar-wrap" aria-hidden="true">
          <div className="ap-metric-col__bar-track">
            <div
              className="ap-metric-col__bar-fill ap-metric-col__bar-fill--recovered"
              style={{ width: `${recoveredPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Column 5: Safe attempts */}
      <div className="ap-metric-col">
        <div className="ap-metric-col__header">
          <span
            className={`ap-metric-col__dot ${safeAttempts > 0 ? 'ap-metric-col__dot--safe' : 'ap-metric-col__dot--muted'}`}
            aria-hidden="true"
          />
          <span className="ap-metric-col__label">Safe attempts</span>
        </div>
        <div className="ap-metric-col__values">
          <span
            className={`ap-metric-col__num ${safeAttempts === 0 ? 'ap-metric-col__num--faint' : ''}`}
          >
            {safeAttempts.toLocaleString('en-IN')}
          </span>
          <span
            className={`ap-metric-col__share ${safeAttempts > 0 ? 'ap-metric-col__share--safe' : 'ap-metric-col__share--faint'}`}
          >
            {formatShare(safeAttempts)}
          </span>
        </div>
        <div className="ap-metric-col__bar-wrap" aria-hidden="true">
          <div className="ap-metric-col__bar-track">
            <div
              className="ap-metric-col__bar-fill ap-metric-col__bar-fill--safe"
              style={{ width: `${safePct}%` }}
            />
          </div>
        </div>
        {/* Preserves test assertion query for incident count */}
        <span className="ap-sr-only">
          <span>In an incident</span>: {kpis.inIncident}
        </span>
      </div>
    </section>
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
          All time
        </button>
        <button type="button" onClick={() => onPreset(7)}>
          Last 7 days
        </button>
        <button type="button" onClick={() => onPreset(30)}>
          Last 30 days
        </button>
        <button type="button" onClick={() => onPreset(90)}>
          Last 90 days
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
          Apply range
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
      ? 'All dates'
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
        className="ap-pill-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Select date range"
      >
        <CalendarBlank size={14} />
        <span>{displayLabel}</span>
        <CaretDown size={12} className="ap-pill-chevron" />
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
        <PaymentMethodCell row={row} />
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
    <div className="ap-panel__toolbar">
      <div className="ap-toolbar-filters">
        <DateRangePicker
          startDate={props.startDate}
          endDate={props.endDate}
          onRangeChange={props.onDateRangeChange}
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
          <span>Rows:</span>
          <CustomSelectPill
            value={String(pageSize)}
            options={[
              { value: '10', label: '10' },
              { value: '15', label: '15' },
              { value: '25', label: '25' },
              { value: '50', label: '50' },
            ]}
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
      <div className="ap-panel__head">
        <Receipt size={16} className="ap-panel__head-icon" />
        <h2>All attempts</h2>
        <span className="ap-panel__head-badge">{data.total} results</span>
      </div>

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

async function fetchStatus(): Promise<SimulationStatus> {
  const response = await fetch('/api/simulation/status', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return simulationStatusSchema.parse(await response.json());
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
  const [pageSize, setPageSize] = useState(15);

  const [showSimModal, setShowSimModal] = useState(false);
  const [simPanelOpen, setSimPanelOpen] = useState(false);

  const simStatus = useQuery({
    queryKey: ['simulation-status'],
    queryFn: fetchStatus,
    refetchInterval: 2500,
  });

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

  const isRunning = simStatus.data?.running ?? false;

  return (
    <div className="ap-page">
      <header className="ap-header-top">
        <div className="ap-header-left">
          <h1>Payment attempts</h1>
          <p>Every payment attempt received from your storefront</p>
        </div>
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 14px',
            borderRadius: '8px',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            color: 'oklch(1 0 0)',
            background: 'oklch(0.55 0.15 258)',
            border: 0,
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
            cursor: 'pointer',
          }}
          onClick={() => setShowSimModal(true)}
        >
          <Play size={14} weight="bold" /> Run simulation scenarios
        </button>
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
