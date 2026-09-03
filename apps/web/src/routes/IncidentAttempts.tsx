import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Card } from '@sentinel/ui';
import type { IncidentDetail } from '@sentinel/contracts';

import visaLogo from '../assets/payments/visa.png';
import mastercardLogo from '../assets/payments/mastercard.svg';
import rupayLogo from '../assets/payments/rupay.png';
import amexLogo from '../assets/payments/amex.svg';
import upiLogo from '../assets/payments/upi.svg';
import netbankingLogo from '../assets/payments/netbanking.svg';
import walletLogo from '../assets/payments/wallet.png';

import { Wallet } from '@phosphor-icons/react';
import './IncidentAttempts.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';

const PAGE_SIZE = 10;

type Attempt = IncidentDetail['relatedOrders'][number]['attempts'][number];
type Status = Attempt['status'];
type AttemptRow = { attempt: Attempt; orderId: string };

const rupees = (paise: number | null): string =>
  paise === null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function humanizeReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return '—';
  const text = reason.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STATUS_TONE: Record<Status, string> = {
  created: 'neutral',
  failed: 'critical',
  authorized: 'warn',
  captured: 'ok',
  refunded: 'warn',
};
const STATUS_LABEL: Record<Status, string> = {
  created: 'Created',
  failed: 'Failed',
  authorized: 'Authorized',
  captured: 'Captured',
  refunded: 'Refunded',
};
const STATUS_OPTIONS = [
  ['all', 'All statuses'],
  ['captured', 'Captured'],
  ['failed', 'Failed'],
  ['authorized', 'Authorized'],
  ['refunded', 'Refunded'],
  ['created', 'Created'],
] as const;

const CARD_BRANDS: Record<string, { logo: string; cls: string; label: string }> = {
  visa: { logo: visaLogo, cls: 'ap-pm-logo--visa', label: 'Visa' },
  mastercard: { logo: mastercardLogo, cls: 'ap-pm-logo--mastercard', label: 'Mastercard' },
  rupay: { logo: rupayLogo, cls: 'ap-pm-logo--rupay', label: 'RuPay' },
  amex: { logo: amexLogo, cls: 'ap-pm-logo--amex', label: 'Amex' },
};

function PaymentMethodCell({ attempt }: { attempt: Attempt }): React.JSX.Element {
  const method = attempt.method?.toLowerCase();
  const network = attempt.cardNetwork?.toLowerCase();

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
          <Wallet size={15} color="oklch(0.5 0.015 280)" />
        </div>
        <span>Wallet</span>
      </div>
    );
  }

  // Card payment: the network Razorpay actually reported, never an invented brand or card number.
  const brand = network === undefined ? undefined : CARD_BRANDS[network];
  if (brand === undefined) {
    return (
      <div className="ap-pm-cell">
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

function Row({ row }: { row: AttemptRow }): React.JSX.Element {
  const { attempt, orderId } = row;
  const tone = STATUS_TONE[attempt.status];
  const reason = attempt.failure?.reason ?? attempt.failure?.description ?? null;
  return (
    <tr>
      <td className="ia-time" title={new Date(attempt.firstSeenAt).toLocaleString()}>
        {formatTime(attempt.firstSeenAt)}
      </td>
      <td>
        <Link
          className="ia-id ia-id--link"
          to="/console/attempts/$paymentId"
          params={{ paymentId: attempt.razorpayPaymentId }}
        >
          {attempt.razorpayPaymentId}
        </Link>
      </td>
      <td>
        <code className="ia-id ia-id--muted">{orderId}</code>
      </td>
      <td className="ia-amount">{rupees(attempt.amountPaise)}</td>
      <td>
        <PaymentMethodCell attempt={attempt} />
      </td>
      <td>
        <span className={`ia-chip ia-chip--${tone}`}>
          <i className={`ia-dot ia-dot--${tone}`} aria-hidden="true" />
          {STATUS_LABEL[attempt.status]}
        </span>
      </td>
      <td className="ia-reason" title={reason ?? undefined}>
        {humanizeReason(reason)}
      </td>
      <td className="ia-actions">
        <Link
          to="/console/attempts/$paymentId"
          params={{ paymentId: attempt.razorpayPaymentId }}
          aria-label={`Open attempt ${attempt.razorpayPaymentId}`}
        >
          ›
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
    <nav className="ia-pager" aria-label="Pagination">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        ‹
      </button>
      {shown.map((p, index) => (
        <span key={p}>
          {index > 0 && p - shown[index - 1]! > 1 && <span className="ia-pager__gap">…</span>}
          <button
            type="button"
            className={p === page ? 'is-active' : undefined}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        </span>
      ))}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>
        ›
      </button>
    </nav>
  );
}

const HEADERS = [
  'Time',
  'Payment ID',
  'Order ID',
  'Amount',
  'Payment method',
  'Status',
  'Failure reason',
];

function AttemptsToolbar({
  search,
  statusFilter,
  onSearch,
  onStatus,
}: {
  search: string;
  statusFilter: string;
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="ia-tools">
      <label className="ia-search">
        <span className="ia-search__icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          value={search}
          placeholder="Search by payment ID or order ID"
          aria-label="Search related attempts"
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <CustomSelectPill
        value={statusFilter}
        options={STATUS_OPTIONS.map(([value, text]) => ({
          value,
          label: text,
        }))}
        onChange={(val) => onStatus(val)}
        ariaLabel="Filter by status"
      />
    </div>
  );
}

function Results({
  shown,
  total,
  current,
  pageCount,
  onPage,
}: {
  shown: AttemptRow[];
  total: number;
  current: number;
  pageCount: number;
  onPage: (page: number) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="ia-table-wrap">
        <table className="ia-table">
          <thead>
            <tr>
              {HEADERS.map((header) => (
                <th key={header}>{header}</th>
              ))}
              <th aria-label="Detail" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Row key={row.attempt.razorpayPaymentId} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="ia-foot">
        <span className="ia-muted">
          Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, total)} of {total}{' '}
          attempts
        </span>
        {total > PAGE_SIZE && <Pager page={current} pageCount={pageCount} onPage={onPage} />}
      </div>
    </>
  );
}

export function IncidentAttemptsTab({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const all: AttemptRow[] = incident.relatedOrders
    .flatMap((order) =>
      order.attempts.map((attempt) => ({ attempt, orderId: order.razorpayOrderId })),
    )
    .sort((a, b) => Date.parse(b.attempt.firstSeenAt) - Date.parse(a.attempt.firstSeenAt));

  const term = search.trim().toLowerCase();
  const filtered = all.filter((row) => {
    if (statusFilter !== 'all' && row.attempt.status !== statusFilter) return false;
    if (term === '') return true;
    return (
      row.attempt.razorpayPaymentId.toLowerCase().includes(term) ||
      row.orderId.toLowerCase().includes(term) ||
      (row.attempt.cardFingerprint?.toLowerCase().includes(term) ?? false)
    );
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const tools = (
    <AttemptsToolbar
      search={search}
      statusFilter={statusFilter}
      onSearch={(value) => {
        setSearch(value);
        setPage(1);
      }}
      onStatus={(value) => {
        setStatusFilter(value);
        setPage(1);
      }}
    />
  );

  return (
    <Card
      title={`Related payment attempts (${all.length})`}
      subtitle="Payments connected to this incident through shared activity. One row per payment."
      actions={all.length > 0 ? tools : undefined}
      variant="flush"
    >
      {all.length === 0 ? (
        <p className="ia-empty">No payment attempts are linked to this incident yet.</p>
      ) : filtered.length === 0 ? (
        <p className="ia-empty">No attempts match your search or filter.</p>
      ) : (
        <Results
          shown={shown}
          total={filtered.length}
          current={current}
          pageCount={pageCount}
          onPage={setPage}
        />
      )}
    </Card>
  );
}
