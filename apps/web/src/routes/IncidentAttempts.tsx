import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { IncidentDetail } from '@sentinel/contracts';

import visaLogo from '../assets/payments/visa.png';
import mastercardLogo from '../assets/payments/mastercard.svg';
import rupayLogo from '../assets/payments/rupay.png';
import amexLogo from '../assets/payments/amex.svg';
import upiLogo from '../assets/payments/upi.svg';
import netbankingLogo from '../assets/payments/netbanking.svg';

import {
  Receipt,
  MagnifyingGlass,
  CaretRight,
  CaretLeft,
  CreditCard,
  Wallet,
} from '@phosphor-icons/react';
import './IncidentAttempts.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';

const PAGE_SIZE = 10;

type Attempt = IncidentDetail['relatedOrders'][number]['attempts'][number];
type Status = Attempt['status'];
type AttemptRow = { attempt: Attempt; orderId: string };

const formatRupees = (paise: number | null): React.JSX.Element => {
  if (paise === null) return <span>—</span>;
  const numStr = (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <span style={{ fontWeight: 550, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontWeight: 500 }}>₹</span>
      {numStr}
    </span>
  );
};

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

const STATUS_STYLES: Record<Status, { bg: string; color: string; label: string }> = {
  failed: {
    bg: 'oklch(0.96 0.02 18)',
    color: 'oklch(0.45 0.16 22)',
    label: 'Failed',
  },
  captured: {
    bg: 'oklch(0.955 0.03 162)',
    color: 'oklch(0.4 0.11 162)',
    label: 'Captured',
  },
  authorized: {
    bg: 'oklch(0.96 0.03 85)',
    color: 'oklch(0.45 0.12 85)',
    label: 'Authorized',
  },
  refunded: {
    bg: 'oklch(0.96 0.03 85)',
    color: 'oklch(0.45 0.12 85)',
    label: 'Refunded',
  },
  created: {
    bg: 'oklch(0.958 0.006 280)',
    color: 'oklch(0.44 0.015 280)',
    label: 'Created',
  },
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
  visa: { logo: visaLogo, cls: 'ap-method-logo--visa', label: 'Visa' },
  mastercard: { logo: mastercardLogo, cls: 'ap-method-logo--mc', label: 'Mastercard' },
  rupay: { logo: rupayLogo, cls: 'ap-method-logo--rupay', label: 'RuPay' },
  amex: { logo: amexLogo, cls: 'ap-method-logo--amex', label: 'Amex' },
};

function StatusBadge({ status }: { status: Status }): React.JSX.Element {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.created;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 'var(--s-radius-pill)',
        fontSize: '11.5px',
        fontWeight: 600,
        background: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
  );
}

function PaymentMethodCell({ attempt }: { attempt: Attempt }): React.JSX.Element {
  const method = attempt.method?.toLowerCase();
  const network = attempt.cardNetwork?.toLowerCase();

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

function Row({ row }: { row: AttemptRow }): React.JSX.Element {
  const { attempt, orderId } = row;
  const reason = attempt.failure?.reason ?? attempt.failure?.description ?? null;
  return (
    <tr
      style={{
        borderBottom: '1px solid oklch(0.955 0.006 280)',
        transition: 'background 0.12s ease',
      }}
      className="ia-tr"
    >
      <td
        style={{
          padding: '12px 16px',
          fontSize: '12px',
          fontWeight: 500,
          color: 'oklch(0.42 0.015 280)',
          whiteSpace: 'nowrap',
        }}
        title={new Date(attempt.firstSeenAt).toLocaleString()}
      >
        {formatTime(attempt.firstSeenAt)}
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <Link
          to="/console/attempts/$paymentId"
          params={{ paymentId: attempt.razorpayPaymentId }}
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '12px',
            fontWeight: 600,
            color: 'oklch(0.46 0.12 258)',
            textDecoration: 'none',
          }}
          className="ia-link"
        >
          {attempt.razorpayPaymentId}
        </Link>
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '12px',
            fontWeight: 500,
            color: 'oklch(0.52 0.015 280)',
          }}
        >
          {orderId}
        </span>
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        {formatRupees(attempt.amountPaise)}
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <PaymentMethodCell attempt={attempt} />
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <StatusBadge status={attempt.status} />
      </td>
      <td
        style={{
          padding: '12px 16px',
          fontSize: '12px',
          fontWeight: 500,
          color: 'oklch(0.52 0.015 280)',
          whiteSpace: 'nowrap',
        }}
        title={reason ?? undefined}
      >
        {humanizeReason(reason)}
      </td>
      <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <Link
          to="/console/attempts/$paymentId"
          params={{ paymentId: attempt.razorpayPaymentId }}
          aria-label={`Open attempt ${attempt.razorpayPaymentId}`}
          style={{ display: 'inline-flex', alignItems: 'center', color: 'oklch(0.68 0.015 280)' }}
        >
          <CaretRight size={14} />
        </Link>
      </td>
    </tr>
  );
}

const HEADERS = ['TIME', 'PAYMENT ID', 'ORDER ID', 'AMOUNT', 'METHOD', 'STATUS', 'FAILURE REASON'];

const thStyle: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: '10.5px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'oklch(0.56 0.015 280)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

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
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
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
            <Receipt size={16} color="oklch(0.46 0.12 258)" />
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
              Related payment attempts ({all.length})
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              Payments connected to this incident through shared activity. One row per payment.
            </p>
          </div>
        </div>

        {all.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MagnifyingGlass
                size={14}
                color="oklch(0.56 0.015 280)"
                style={{ position: 'absolute', left: '11px', pointerEvents: 'none' }}
              />
              <input
                type="search"
                value={search}
                placeholder="Search by payment or order ID..."
                aria-label="Search related attempts"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{
                  padding: '6px 12px 6px 32px',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  color: 'oklch(0.21 0.015 280)',
                  background: 'oklch(0.99 0.002 270)',
                  border: '1px solid oklch(0.91 0.006 280)',
                  borderRadius: '8px',
                  outline: 'none',
                  width: '240px',
                }}
              />
            </div>
            <CustomSelectPill
              value={statusFilter}
              options={STATUS_OPTIONS.map(([value, text]) => ({
                value,
                label: text,
              }))}
              onChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
              ariaLabel="Filter by status"
            />
          </div>
        )}
      </div>

      {/* Content */}
      {all.length === 0 ? (
        <p
          style={{
            padding: '24px 20px',
            margin: 0,
            fontSize: '13px',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          No payment attempts are linked to this incident yet.
        </p>
      ) : filtered.length === 0 ? (
        <p
          style={{
            padding: '24px 20px',
            margin: 0,
            fontSize: '13px',
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          No attempts match your search or filter.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    background: 'oklch(0.992 0.002 270)',
                    borderBottom: '1px solid oklch(0.94 0.006 280)',
                  }}
                >
                  {HEADERS.map((header) => (
                    <th key={header} style={thStyle}>
                      {header}
                    </th>
                  ))}
                  <th style={{ ...thStyle, width: '32px' }} aria-label="Detail" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <Row key={row.attempt.razorpayPaymentId} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer & Pagination */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderTop: '1px solid oklch(0.955 0.006 280)',
              fontSize: '12px',
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            <span>
              Showing {(current - 1) * PAGE_SIZE + 1}–
              {Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length} attempts
            </span>

            {pageCount > 1 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current <= 1}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid oklch(0.91 0.006 280)',
                    background: 'oklch(1 0 0)',
                    color: current <= 1 ? 'oklch(0.75 0.006 280)' : 'oklch(0.35 0.015 280)',
                    cursor: current <= 1 ? 'not-allowed' : 'pointer',
                  }}
                  aria-label="Previous page"
                >
                  <CaretLeft size={14} />
                </button>

                <span style={{ fontSize: '12px', fontWeight: 500, color: 'oklch(0.4 0.015 280)' }}>
                  {current} of {pageCount}
                </span>

                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid oklch(0.91 0.006 280)',
                    background: 'oklch(1 0 0)',
                    color: current >= pageCount ? 'oklch(0.75 0.006 280)' : 'oklch(0.35 0.015 280)',
                    cursor: current >= pageCount ? 'not-allowed' : 'pointer',
                  }}
                  aria-label="Next page"
                >
                  <CaretRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
