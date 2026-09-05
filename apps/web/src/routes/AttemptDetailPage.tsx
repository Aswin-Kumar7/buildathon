import { useState } from 'react';
import { WarningCircle, Wallet, ArrowLeft } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ErrorState, Loading, Tabs, type TabItem } from '@sentinel/ui';
import {
  attemptDetailResponseSchema,
  type AttemptDetail,
  type AttemptDetailPayment,
  type AttemptDeviceRecent,
  type AttemptIncidentLink,
  type AttemptSignals,
  type SensorContext,
} from '@sentinel/contracts';

import visaLogo from '../assets/payments/visa.png';
import mastercardLogo from '../assets/payments/mastercard.svg';
import rupayLogo from '../assets/payments/rupay.png';
import amexLogo from '../assets/payments/amex.svg';
import upiLogo from '../assets/payments/upi.svg';
import netbankingLogo from '../assets/payments/netbanking.svg';

import './AttemptDetailPage.css';
import { PaymentMethodCell } from '../shared/PaymentMethod.js';

async function fetchAttempt(paymentId: string): Promise<AttemptDetail> {
  const response = await fetch(`/api/attempts/payment/${paymentId}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return attemptDetailResponseSchema.parse(await response.json()).attempt;
}

const rupees = (paise: number | null): string =>
  paise === null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

const dateTime = (iso: string): string => new Date(iso).toLocaleString('en-IN');

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} sec`;
  return `${minutes} min ${seconds} sec`;
}

function formatSentenceCase(str: string | null | undefined): string {
  if (!str) return '—';
  const lower = str.toLowerCase();
  if (lower === 'upi') return 'UPI';
  if (lower === 'rupay') return 'RuPay';
  if (lower === 'netbanking') return 'Netbanking';
  if (lower === 'mastercard') return 'Mastercard';
  if (lower === 'visa') return 'Visa';
  if (lower === 'amex') return 'Amex';
  if (lower === 'card') return 'Card';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

type StatusKey = AttemptDetailPayment['status'];
const STATUS_LABEL: Record<StatusKey, string> = {
  captured: 'Captured',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  created: 'Created',
};
const ROW_STATUS_LABEL: Record<AttemptDeviceRecent['status'], string> = {
  captured: 'Captured',
  recovered: 'Recovered',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  pending: 'Pending',
};
const CARD_BRANDS: Record<string, { logo: string; cls: string; label: string }> = {
  visa: { logo: visaLogo, cls: 'ap-pm-logo--visa', label: 'Visa' },
  mastercard: { logo: mastercardLogo, cls: 'ap-pm-logo--mastercard', label: 'Mastercard' },
  rupay: { logo: rupayLogo, cls: 'ap-pm-logo--rupay', label: 'RuPay' },
  amex: { logo: amexLogo, cls: 'ap-pm-logo--amex', label: 'Amex' },
};

function MethodFactCell({ payment }: { payment: AttemptDetailPayment }): React.JSX.Element {
  const method = payment.method?.toLowerCase();
  const network = payment.cardNetwork?.toLowerCase();

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

  // Card payment: show the network Razorpay actually reported. No card number is ever shown — the
  // system stores none — and an unknown network reads as a plain "Card", never an invented brand.
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

function statusSentence(payment: AttemptDetailPayment): string {
  switch (payment.status) {
    case 'captured':
      return 'The payment was captured — funds were collected for this order.';
    case 'failed':
      return 'The payment failed — this attempt could not be completed.';
    case 'authorized':
      return 'The payment was authorized and is awaiting capture.';
    case 'refunded':
      return 'The payment was captured and later refunded.';
    default:
      return 'The payment was created but has no terminal outcome yet.';
  }
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="ad-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PaymentDetails({ payment }: { payment: AttemptDetailPayment }): React.JSX.Element {
  const isCaptured = payment.status === 'captured';
  const isFailed = payment.status === 'failed';

  const fields: Array<{
    label: string;
    value: React.ReactNode;
    kind: 'mono' | 'strong' | 'pill' | 'plain';
  }> = [
    { label: 'Payment ID', value: payment.paymentId, kind: 'mono' },
    { label: 'Order ID', value: payment.orderId ?? '—', kind: 'mono' },
    { label: 'Amount', value: rupees(payment.amountPaise), kind: 'strong' },
    { label: 'Currency', value: payment.currency ?? 'INR', kind: 'plain' },
    { label: 'Method', value: formatSentenceCase(payment.method), kind: 'plain' },
    {
      label: 'Status',
      value: (
        <span
          style={{
            display: 'inline-flex',
            padding: '3px 10px',
            borderRadius: 'var(--s-radius-pill)',
            fontSize: '11.5px',
            fontWeight: 600,
            width: 'fit-content',
            color: isCaptured
              ? 'oklch(0.4 0.11 162)'
              : isFailed
                ? 'oklch(0.48 0.15 22)'
                : 'oklch(0.44 0.015 280)',
            background: isCaptured
              ? 'oklch(0.955 0.03 162)'
              : isFailed
                ? 'oklch(0.958 0.026 22)'
                : 'oklch(0.958 0.006 280)',
          }}
        >
          {STATUS_LABEL[payment.status]}
        </span>
      ),
      kind: 'pill',
    },
    { label: 'Captured', value: payment.captured ? 'Yes' : 'No', kind: 'plain' },
    { label: 'Refunded', value: payment.refunded ? 'Yes' : 'No', kind: 'plain' },
    { label: 'First seen', value: dateTime(payment.firstSeenAt), kind: 'plain' },
    { label: 'Last seen', value: dateTime(payment.lastSeenAt), kind: 'plain' },
    { label: 'Events', value: `${payment.eventCount}`, kind: 'plain' },
    { label: 'Source', value: payment.source === 'replay' ? 'Simulation' : 'Live', kind: 'plain' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
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
            Payment details
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            Transaction amounts, payment method facts, and terminal status.
          </p>
        </div>
      </div>

      {/* 3-Column Fields Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {fields.map((field, i) => {
          const hasLeftBorder = i % 3 !== 0;
          const hasBottomBorder = i < 9;
          return (
            <div
              key={field.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
                padding: '14px 20px',
                ...(hasLeftBorder && { borderLeft: '1px solid oklch(0.968 0.006 280)' }),
                ...(hasBottomBorder && { borderBottom: '1px solid oklch(0.968 0.006 280)' }),
              }}
            >
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'oklch(0.56 0.015 280)',
                }}
              >
                {field.label}
              </span>
              {field.kind === 'pill' ? (
                field.value
              ) : field.kind === 'mono' ? (
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    fontSize: '12.5px',
                    fontWeight: 500,
                    color: 'oklch(0.24 0.015 280)',
                    wordBreak: 'break-all',
                  }}
                >
                  {field.value}
                </span>
              ) : field.kind === 'strong' ? (
                <span
                  style={{
                    fontSize: '16px',
                    fontWeight: 400,
                    letterSpacing: '-0.01em',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'oklch(0.19 0.015 280)',
                  }}
                >
                  {field.value}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'oklch(0.26 0.015 280)',
                  }}
                >
                  {field.value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Attempt Status Banner & Notes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '13px 15px',
            borderRadius: '10px',
            background: isCaptured
              ? 'oklch(0.972 0.024 162)'
              : isFailed
                ? 'oklch(0.972 0.026 22)'
                : 'oklch(0.972 0.006 280)',
          }}
        >
          <WarningCircle
            size={16}
            color={
              isCaptured
                ? 'oklch(0.46 0.12 162)'
                : isFailed
                  ? 'oklch(0.5 0.15 22)'
                  : 'oklch(0.5 0.015 280)'
            }
            style={{ flexShrink: 0, marginTop: '2px' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: isCaptured
                  ? 'oklch(0.3 0.07 162)'
                  : isFailed
                    ? 'oklch(0.38 0.12 22)'
                    : 'oklch(0.3 0.015 280)',
              }}
            >
              Attempt status: {STATUS_LABEL[payment.status]}
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                lineHeight: 1.55,
                color: isCaptured
                  ? 'oklch(0.38 0.05 162)'
                  : isFailed
                    ? 'oklch(0.42 0.08 22)'
                    : 'oklch(0.45 0.015 280)',
                textWrap: 'pretty',
              }}
            >
              {statusSentence(payment)}
            </span>
          </div>
        </div>

        <p
          style={{
            margin: 0,
            maxWidth: '88ch',
            fontSize: '12.5px',
            fontWeight: 500,
            lineHeight: 1.65,
            color: 'oklch(0.48 0.015 280)',
          }}
        >
          This attempt is not an incident on its own. A single payment is never judged risky or safe
          by itself — it is evaluated only as part of your overall payment activity, once many
          attempts and behavioural factors line up.
        </p>

        <p
          style={{
            margin: 0,
            maxWidth: '88ch',
            fontSize: '11.5px',
            fontWeight: 500,
            lineHeight: 1.6,
            color: 'oklch(0.62 0.015 280)',
          }}
        >
          A card’s last four is never stored — for a tokenised card it is the token’s last four, not
          the card’s. Distinct cards are told apart by a token fingerprint instead.
        </p>
      </div>
    </div>
  );
}

function IncidentAssociation({
  incident,
}: {
  incident: AttemptIncidentLink | null;
}): React.JSX.Element {
  return (
    <div
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
            Incident association
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            Correlation with fraud detectors.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px' }}>
        {incident === null ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              padding: '13px 15px',
              borderRadius: '10px',
              background: 'oklch(0.978 0.002 270)',
              border: '1px solid oklch(0.94 0.006 280)',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
              Standalone attempt
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                lineHeight: 1.5,
                color: 'oklch(0.52 0.015 280)',
              }}
            >
              This attempt is not currently part of any detected incident.
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                padding: '13px 15px',
                borderRadius: '10px',
                background: 'oklch(0.958 0.026 22)',
                border: '1px solid oklch(0.93 0.02 22)',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'oklch(0.42 0.15 22)' }}>
                Part of an incident
              </span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  lineHeight: 1.5,
                  color: 'oklch(0.48 0.14 22)',
                }}
              >
                This attempt correlates with other activity the detector grouped together.
              </span>
            </div>

            <dl className="ad-facts ad-facts--sidebar">
              <Fact label="Incident">
                <Link className="ad-link" to="/console/incidents/$id" params={{ id: incident.id }}>
                  {incident.ref}
                </Link>
              </Fact>
              <Fact label="Name">{incident.title}</Fact>
              <Fact label="Severity">
                <span
                  style={{
                    display: 'inline-flex',
                    padding: '3px 10px',
                    borderRadius: 'var(--s-radius-pill)',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    width: 'fit-content',
                    color:
                      incident.severity === 'high'
                        ? 'oklch(0.48 0.15 22)'
                        : incident.severity === 'medium'
                          ? 'oklch(0.45 0.12 70)'
                          : 'oklch(0.44 0.015 280)',
                    background:
                      incident.severity === 'high'
                        ? 'oklch(0.958 0.026 22)'
                        : incident.severity === 'medium'
                          ? 'oklch(0.965 0.03 70)'
                          : 'oklch(0.958 0.006 280)',
                  }}
                >
                  {incident.severity}
                </span>
              </Fact>
              <Fact label="Grouped by">{incident.entityKind}</Fact>
              <Fact label="Linked attempts">{incident.attempts}</Fact>
              {incident.distinctCards !== null && (
                <Fact label="Linked cards">{incident.distinctCards}</Fact>
              )}
              <Fact label="Linked devices">{incident.distinctDevices}</Fact>
              <Fact label="Linked sessions">{incident.distinctSessions}</Fact>
              <Fact label="Window">{duration(incident.windowMs)}</Fact>
              <Fact label="Reason">{incident.reason}</Fact>
            </dl>
            <Link className="ad-cta" to="/console/incidents/$id" params={{ id: incident.id }}>
              View incident →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function MonitoringSignals({ signals }: { signals: AttemptSignals | null }): React.JSX.Element {
  if (signals === null) {
    return (
      <div
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
              Monitoring signals
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
                textWrap: 'pretty',
              }}
            >
              Observations recorded at the time of this attempt.
            </p>
          </div>
        </div>
        <p
          style={{
            margin: 0,
            padding: '16px 20px',
            fontSize: '12.5px',
            fontWeight: 500,
            color: 'oklch(0.52 0.015 280)',
          }}
        >
          No checkout context was captured for this attempt, so device- and network-level
          observations aren’t available. Nothing is invented in their place.
        </p>
      </div>
    );
  }

  const amount =
    signals.amountVsTypical === 'typical'
      ? 'Within the shop’s normal range'
      : signals.amountVsTypical === 'above'
        ? `Above this shop’s typical (≈ ${rupees(signals.typicalAmountPaise)})`
        : signals.amountVsTypical === 'below'
          ? `Below this shop’s typical (≈ ${rupees(signals.typicalAmountPaise)})`
          : 'Not enough history to compare';

  const rows: { label: string; desc: string; value: string }[] = [
    {
      label: 'Velocity',
      desc: `Attempts from this device in the last ${signals.windowSeconds}s`,
      value: `${signals.attemptsInWindow}`,
    },
    {
      label: 'Failure rate',
      desc: `Failed of ${signals.attemptsInWindow} in that window`,
      value:
        signals.failureRate === null
          ? '—'
          : `${percent(signals.failureRate)} (${signals.failuresInWindow}/${signals.attemptsInWindow})`,
    },
    {
      label: 'Device history',
      desc: 'Was this device active before this window',
      value: signals.deviceSeenBefore ? 'Seen before' : 'First seen now',
    },
    {
      label: 'Network sharing',
      desc: `Distinct devices on this network in the last ${Math.round(signals.networkWindowSeconds / 60)} min`,
      value: `${signals.networkDistinctDevices}`,
    },
    {
      label: 'Card reuse',
      desc: `This card tried in the last ${signals.windowSeconds}s`,
      value: signals.cardReuseInWindow === null ? 'Not a card' : `${signals.cardReuseInWindow}×`,
    },
    {
      label: 'Amount deviation',
      desc: 'This amount vs the shop’s typical',
      value: amount,
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
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
            Monitoring signals
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            Observations recorded at the time of this attempt.
          </p>
        </div>
      </div>

      {/* Signal Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 20px 6px' }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '18px',
              padding: '12px 0',
              ...(i < rows.length - 1 && { borderBottom: '1px solid oklch(0.968 0.006 280)' }),
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '-0.012em',
                  color: 'oklch(0.24 0.015 280)',
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'oklch(0.56 0.015 280)',
                  textWrap: 'pretty',
                }}
              >
                {row.desc}
              </span>
            </div>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'right',
                color: 'oklch(0.22 0.015 280)',
                whiteSpace: 'nowrap',
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <p
        style={{
          margin: 0,
          padding: '12px 20px 18px',
          maxWidth: '88ch',
          fontSize: '12.5px',
          fontWeight: 500,
          lineHeight: 1.65,
          color: 'oklch(0.48 0.015 280)',
          textWrap: 'pretty',
        }}
      >
        These are observations, not a score. Risk is evaluated only after correlating multiple
        attempts — no single number here judges this payment.
      </p>
    </div>
  );
}

function Context({ context }: { context: SensorContext | null }): React.JSX.Element | null {
  if (context === null) return null;

  const rows: Array<{ label: string; value: React.ReactNode; isMono?: boolean }> = [
    { label: 'Session', value: context.sessionFingerprint, isMono: true },
    { label: 'Device', value: context.deviceFingerprint, isMono: true },
    { label: 'Network', value: context.ipFingerprint, isMono: true },
    { label: 'Browser', value: context.userAgentFamily, isMono: false },
    { label: 'Items in cart', value: `${context.itemCount}`, isMono: false },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
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
            Checkout context
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            The storefront’s record of who was checking out.
          </p>
        </div>
      </div>

      {/* Context Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 20px 6px' }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '12px 0',
              ...(i < rows.length - 1 && { borderBottom: '1px solid oklch(0.968 0.006 280)' }),
            }}
          >
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              {row.label}
            </span>
            {row.isMono ? (
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'oklch(0.28 0.015 280)',
                  background: 'oklch(0.962 0.004 270)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: '1px solid oklch(0.92 0.006 280)',
                  wordBreak: 'break-all',
                  width: 'fit-content',
                }}
              >
                {row.value}
              </span>
            ) : (
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'oklch(0.26 0.015 280)',
                }}
              >
                {row.value}
              </span>
            )}
          </div>
        ))}
      </div>

      <p
        style={{
          margin: 0,
          padding: '12px 20px 18px',
          fontSize: '12px',
          fontWeight: 500,
          lineHeight: 1.6,
          color: 'oklch(0.5 0.015 280)',
          textWrap: 'pretty',
        }}
      >
        These are keyed fingerprints — enough to tell two checkouts apart, never the values behind
        them.
      </p>
    </div>
  );
}

function RecentFromDevice({ rows }: { rows: AttemptDeviceRecent[] }): React.JSX.Element | null {
  if (rows.length === 0) return null;

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
        marginBottom: '14px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
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
            Recent attempts from this device
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            Chronological attempt history on this device fingerprint.
          </p>
        </div>
      </div>

      {/* Table Container */}
      <div className="om-scroll" style={{ overflowX: 'auto' }}>
        {/* Table Header Row */}
        <div
          style={{
            display: 'grid',
            // Weighted by how much text each column holds, so the leftover width is shared out rather
            // than pooling behind Payment ID and leaving Amount jammed against Status.
            gridTemplateColumns:
              'minmax(96px, 0.78fr) minmax(196px, 1.35fr) minmax(112px, 0.86fr) minmax(96px, 0.72fr) minmax(100px, 0.76fr)',
            gap: '18px',
            minWidth: '780px',
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
          <span>Time</span>
          <span>Payment ID</span>
          <span>Method</span>
          <span>Amount</span>
          <span>Status</span>
        </div>

        {/* Table Data Rows */}
        {rows.map((row) => {
          const isCaptured = row.status === 'captured';
          const isFailed = row.status === 'failed';
          const isRecovered = row.status === 'recovered';
          const isAuthorized = row.status === 'authorized';

          const badgeColor = isCaptured
            ? 'oklch(0.4 0.11 162)'
            : isFailed
              ? 'oklch(0.46 0.13 22)'
              : isRecovered
                ? 'oklch(0.35 0.12 250)'
                : isAuthorized
                  ? 'oklch(0.45 0.12 70)'
                  : 'oklch(0.45 0.015 280)';

          const badgeBg = isCaptured
            ? 'oklch(0.955 0.03 162)'
            : isFailed
              ? 'oklch(0.958 0.026 22)'
              : isRecovered
                ? 'oklch(0.962 0.025 250)'
                : isAuthorized
                  ? 'oklch(0.965 0.03 70)'
                  : 'oklch(0.958 0.006 280)';

          return (
            <div
              key={row.paymentId}
              style={{
                display: 'grid',
                // Weighted by how much text each column holds, so the leftover width is shared out rather
                // than pooling behind Payment ID and leaving Amount jammed against Status.
                gridTemplateColumns:
                  'minmax(96px, 0.78fr) minmax(196px, 1.35fr) minmax(112px, 0.86fr) minmax(96px, 0.72fr) minmax(100px, 0.76fr)',
                gap: '18px',
                minWidth: '780px',
                alignItems: 'center',
                padding: '12px 20px',
                borderBottom: '1px solid oklch(0.97 0.006 280)',
                background: row.isCurrent ? 'oklch(0.984 0.008 260)' : 'transparent',
              }}
            >
              {/* Time */}
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'oklch(0.3 0.015 280)',
                }}
              >
                {new Date(row.at).toLocaleTimeString('en-IN')}
              </span>

              {/* Payment ID */}
              <div>
                {row.isCurrent ? (
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'oklch(0.32 0.015 280)',
                      background: 'oklch(0.962 0.004 270)',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: '1px solid oklch(0.92 0.006 280)',
                    }}
                  >
                    {row.paymentId}
                  </span>
                ) : (
                  <Link
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'oklch(0.35 0.16 250)',
                      textDecoration: 'none',
                    }}
                    to="/console/attempts/$paymentId"
                    params={{ paymentId: row.paymentId }}
                  >
                    {row.paymentId}
                  </Link>
                )}
              </div>

              {/* Card */}
              <PaymentMethodCell method={row.method} cardNetwork={row.cardNetwork} />

              {/* Amount */}
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'oklch(0.24 0.015 280)',
                }}
              >
                {rupees(row.amountPaise)}
              </span>

              {/* Status Badge */}
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
                  color: badgeColor,
                  background: badgeBg,
                }}
              >
                {ROW_STATUS_LABEL[row.status]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type DetailTab = 'overview' | 'activity' | 'signals';

function HeroBanner({ payment }: { payment: AttemptDetailPayment }): React.JSX.Element {
  const isCaptured = payment.status === 'captured';
  const isFailed = payment.status === 'failed';

  const statusColor = isCaptured
    ? 'oklch(0.4 0.11 162)'
    : isFailed
      ? 'oklch(0.46 0.13 22)'
      : 'oklch(0.44 0.015 280)';

  const statusBg = isCaptured
    ? 'oklch(0.955 0.03 162)'
    : isFailed
      ? 'oklch(0.958 0.026 22)'
      : 'oklch(0.958 0.006 280)';

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
        marginBottom: '14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '20px',
          flexWrap: 'wrap',
          padding: '18px 22px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', minWidth: 0 }}>
          {/* Status Badge + Monospace Payment ID */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '7px',
                fontSize: '10.5px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: statusColor,
                background: statusBg,
              }}
            >
              {STATUS_LABEL[payment.status]}
            </span>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '7px',
                fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.32 0.015 280)',
                background: 'oklch(0.962 0.004 270)',
                border: '1px solid oklch(0.92 0.006 280)',
              }}
            >
              {payment.paymentId}
            </span>
          </div>

          {/* Amount + Currency */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
            <span
              style={{
                fontSize: '34px',
                fontWeight: 600,
                letterSpacing: '-0.03em',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                color: 'oklch(0.19 0.015 280)',
              }}
            >
              {rupees(payment.amountPaise)}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'oklch(0.6 0.015 280)' }}>
              {payment.currency ?? 'INR'}
            </span>
          </div>

          {/* Fact Meta Line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <MethodFactCell payment={payment} />
            <span
              style={{
                width: '3px',
                height: '3px',
                borderRadius: '99px',
                background: 'oklch(0.82 0.01 280)',
              }}
            />
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                color: 'oklch(0.46 0.015 280)',
              }}
            >
              {dateTime(payment.firstSeenAt)}
            </span>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'oklch(0.42 0.015 280)',
                background: 'oklch(0.958 0.006 280)',
              }}
            >
              {payment.source === 'replay' ? 'Simulation' : 'Live'}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'oklch(0.48 0.12 62)',
                background: 'oklch(0.962 0.028 72)',
              }}
            >
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '99px',
                  background: 'oklch(0.68 0.14 62)',
                }}
              />
              Test mode
            </span>
          </div>
        </div>

        {/* Failure Highlight if present */}
        {payment.failure !== null && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '4px',
              maxWidth: '480px',
              textAlign: 'right',
              marginLeft: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'oklch(0.46 0.13 22)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '99px',
                  background: 'oklch(0.62 0.17 22)',
                  flexShrink: 0,
                }}
              />
              <strong>
                Payment Failed:{' '}
                {payment.failure.description ?? payment.failure.reason ?? 'Declined'}
              </strong>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '12.5px',
                fontWeight: 500,
                color: 'oklch(0.55 0.015 280)',
                lineHeight: 1.45,
              }}
            >
              Declined by {payment.failure.source ?? 'bank'}
              {payment.failure.step ? ` during ${payment.failure.step}` : ''}
              {payment.failure.code ? ` · ${payment.failure.code}` : ''}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

const DETAIL_TABS: TabItem[] = [
  { id: 'overview', label: 'Payment details' },
  { id: 'activity', label: 'Device history' },
  { id: 'signals', label: 'Signals & context' },
];

function TabNav({
  activeTab,
  onTab,
}: {
  activeTab: DetailTab;
  onTab: (tab: DetailTab) => void;
}): React.JSX.Element {
  return (
    <Tabs
      items={DETAIL_TABS}
      active={activeTab}
      onChange={(id: string) => onTab(id as DetailTab)}
    />
  );
}

export function AttemptDetailPage(): React.JSX.Element {
  const { paymentId } = useParams({ from: '/console/attempts/$paymentId' });
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  const attempt = useQuery({
    queryKey: ['attempt', paymentId],
    queryFn: () => fetchAttempt(paymentId),
  });

  if (attempt.isPending) return <Loading label="Loading payment attempt…" />;
  if (attempt.isError) {
    return <ErrorState title="Could not load this attempt" message={attempt.error.message} />;
  }

  const it = attempt.data;
  const { payment } = it;

  return (
    <div className="ad-page">
      <nav className="ad-breadcrumb" aria-label="Breadcrumb">
        <Link to="/console/attempts" className="ad-back">
          <ArrowLeft />
          <span>Back to attempts</span>
        </Link>
      </nav>

      <HeroBanner payment={payment} />

      <TabNav activeTab={activeTab} onTab={setActiveTab} />

      {/* Tab Panel 1: Overview */}
      <div
        className="ad-tab-panel"
        style={{ display: activeTab === 'overview' ? 'block' : 'none' }}
      >
        <div className="ad-grid">
          <div className="ad-main">
            <PaymentDetails payment={payment} />
          </div>
          <aside className="ad-side">
            <IncidentAssociation incident={it.incident} />
          </aside>
        </div>
      </div>

      {/* Tab Panel 2: Device Pulse */}
      <div
        className="ad-tab-panel"
        style={{ display: activeTab === 'activity' ? 'block' : 'none' }}
      >
        <div className="ad-grid ad-grid--single">
          <RecentFromDevice rows={it.recentFromDevice} />
        </div>
      </div>

      {/* Tab Panel 3: Risk Signals & Context */}
      <div className="ad-tab-panel" style={{ display: activeTab === 'signals' ? 'block' : 'none' }}>
        <div className="ad-grid">
          <div className="ad-main">
            <MonitoringSignals signals={it.signals} />
          </div>
          <aside className="ad-side">
            <Context context={it.context} />
          </aside>
        </div>
      </div>
    </div>
  );
}
