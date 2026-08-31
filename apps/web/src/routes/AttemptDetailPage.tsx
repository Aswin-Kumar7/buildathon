import { useState } from 'react';
import { Pulse, WarningCircle, Shield } from '@phosphor-icons/react';
import { CreditCard, Laptop, FileCode, ArrowLeft } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge, Card, ErrorState, Loading, StatusDot } from '@sentinel/ui';
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
import walletLogo from '../assets/payments/wallet.png';

import './AttemptDetailPage.css';

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
const STATUS_TONE: Record<StatusKey, 'ok' | 'critical' | 'warn' | 'neutral'> = {
  captured: 'ok',
  failed: 'critical',
  authorized: 'warn',
  refunded: 'warn',
  created: 'neutral',
};
const STATUS_LABEL: Record<StatusKey, string> = {
  captured: 'Captured',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  created: 'Created',
};
const ROW_STATUS_TONE: Record<AttemptDeviceRecent['status'], string> = {
  captured: 'ok',
  recovered: 'info',
  failed: 'critical',
  authorized: 'warn',
  refunded: 'warn',
  pending: 'neutral',
};
const ROW_STATUS_LABEL: Record<AttemptDeviceRecent['status'], string> = {
  captured: 'Captured',
  recovered: 'Recovered',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  pending: 'Pending',
};
const SEVERITY_TONE = { high: 'critical', medium: 'warn', low: 'neutral' } as const;

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

function cardCohort(payment: AttemptDetailPayment): string | null {
  const parts = [
    formatSentenceCase(payment.cardNetwork),
    formatSentenceCase(payment.cardType),
    formatSentenceCase(payment.cardIssuer),
  ].filter((part): part is string => part !== null && part !== '' && part !== '—');
  if (parts.length === 0 && payment.cardFingerprint === null) return null;
  const label = parts.join(' · ');
  return payment.cardFingerprint === null
    ? label
    : `${label}${label ? ' · ' : ''}⚹${payment.cardFingerprint}`;
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

function CoreFacts({ payment }: { payment: AttemptDetailPayment }): React.JSX.Element {
  return (
    <>
      <Fact label="Payment ID">
        <code>{payment.paymentId}</code>
      </Fact>
      <Fact label="Order ID">
        <code>{payment.orderId ?? '—'}</code>
      </Fact>
      <Fact label="Amount">
        <strong>{rupees(payment.amountPaise)}</strong>
      </Fact>
      <Fact label="Currency">{payment.currency ?? 'INR'}</Fact>
      <Fact label="Method">
        <MethodFactCell payment={payment} />
      </Fact>
      <Fact label="Status">
        <span className={`ad-chip ad-chip--${STATUS_TONE[payment.status]}`}>
          {STATUS_LABEL[payment.status]}
        </span>
      </Fact>
      <Fact label="Captured">{payment.captured ? 'Yes' : 'No'}</Fact>
      <Fact label="Refunded">{payment.refunded ? 'Yes' : 'No'}</Fact>
      <Fact label="First seen">{dateTime(payment.firstSeenAt)}</Fact>
      <Fact label="Last seen">{dateTime(payment.lastSeenAt)}</Fact>
      <Fact label="Events">{payment.eventCount}</Fact>
      <Fact label="Source">{payment.source === 'replay' ? 'Simulation' : 'Live'}</Fact>
    </>
  );
}

function FailureFacts({
  failure,
}: {
  failure: AttemptDetailPayment['failure'];
}): React.JSX.Element | null {
  if (failure === null) return null;
  return (
    <>
      <Fact label="Failure reason">
        {failure.description ?? failure.reason ?? 'Declined'}
        {failure.code !== null && <span className="ad-muted"> · {failure.code}</span>}
      </Fact>
      {failure.step !== null && <Fact label="Failed at step">{failure.step}</Fact>}
      {failure.source !== null && <Fact label="Declined by">{failure.source}</Fact>}
    </>
  );
}

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

function PaymentDetails({ payment }: { payment: AttemptDetailPayment }): React.JSX.Element {
  const cohort = cardCohort(payment);
  const badgeTone =
    payment.status === 'captured' ? 'green' : payment.status === 'failed' ? 'red' : 'amber';

  return (
    <Card
      title={<CardHeaderTitle icon={<CreditCard />} text="Payment details" badgeTone="blue" />}
      subtitle="Transaction amounts, payment method facts, and terminal status."
    >
      <dl className="ad-facts">
        <CoreFacts payment={payment} />
        {cohort !== null && <Fact label="Card">{cohort}</Fact>}
        <FailureFacts failure={payment.failure} />
        {payment.international !== null && (
          <Fact label="International">{payment.international ? 'Yes' : 'No'}</Fact>
        )}
      </dl>

      <div className={`ad-status ad-status--${STATUS_TONE[payment.status]}`}>
        <div className="ad-status__title-row">
          <span className={`ad-card-badge ad-card-badge--sm ad-card-badge--${badgeTone}`}>
            <WarningCircle />
          </span>
          <strong>Attempt status: {STATUS_LABEL[payment.status]}</strong>
        </div>
        <span>{statusSentence(payment)}</span>
      </div>

      <p className="ad-note">
        This attempt is not an incident on its own. A single payment is never judged risky or safe
        by itself — it is evaluated only as part of your overall payment activity, once many
        attempts and behavioural factors line up.
      </p>
      <p className="ad-note ad-note--subtle">
        A card’s last four is never stored — for a tokenised card it is the token’s last four, not
        the card’s. Distinct cards are told apart by a token fingerprint instead.
      </p>
    </Card>
  );
}

function IncidentAssociation({
  incident,
}: {
  incident: AttemptIncidentLink | null;
}): React.JSX.Element {
  if (incident === null) {
    return (
      <Card
        title={<CardHeaderTitle icon={<Shield />} text="Incident association" badgeTone="grey" />}
        subtitle="Correlation with fraud detectors."
      >
        <div className="ad-assoc ad-assoc--none">
          <strong>Standalone attempt</strong>
          <span>This attempt is not currently part of any detected incident.</span>
        </div>
      </Card>
    );
  }
  return (
    <Card
      title={<CardHeaderTitle icon={<Shield />} text="Incident association" badgeTone="red" />}
      subtitle="Correlated risk detection."
    >
      <div className="ad-assoc ad-assoc--linked">
        <strong>Part of an incident</strong>
        <span>This attempt correlates with other activity the detector grouped together.</span>
      </div>
      <dl className="ad-facts ad-facts--sidebar">
        <Fact label="Incident">
          <Link className="ad-link" to="/console/incidents/$id" params={{ id: incident.id }}>
            {incident.ref}
          </Link>
        </Fact>
        <Fact label="Name">{incident.title}</Fact>
        <Fact label="Severity">
          <Badge tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Badge>
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
    </Card>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function MonitoringSignals({ signals }: { signals: AttemptSignals | null }): React.JSX.Element {
  if (signals === null) {
    return (
      <Card
        title={<CardHeaderTitle icon={<Pulse />} text="Monitoring signals" badgeTone="purple" />}
        subtitle="What was observed around this attempt."
      >
        <p className="ad-note">
          No checkout context was captured for this attempt, so device- and network-level
          observations aren’t available. Nothing is invented in their place.
        </p>
      </Card>
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

  const rows: { label: string; hint: string; value: string }[] = [
    {
      label: 'Velocity',
      hint: `Attempts from this device in the last ${signals.windowSeconds}s`,
      value: `${signals.attemptsInWindow}`,
    },
    {
      label: 'Failure rate',
      hint: `Failed of ${signals.attemptsInWindow} in that window`,
      value:
        signals.failureRate === null
          ? '—'
          : `${percent(signals.failureRate)} (${signals.failuresInWindow}/${signals.attemptsInWindow})`,
    },
    {
      label: 'Device history',
      hint: 'Was this device active before this window',
      value: signals.deviceSeenBefore ? 'Seen before' : 'First seen now',
    },
    {
      label: 'Network sharing',
      hint: `Distinct devices on this network in the last ${Math.round(signals.networkWindowSeconds / 60)} min`,
      value: `${signals.networkDistinctDevices}`,
    },
    {
      label: 'Card reuse',
      hint: `This card tried in the last ${signals.windowSeconds}s`,
      value: signals.cardReuseInWindow === null ? 'Not a card' : `${signals.cardReuseInWindow}×`,
    },
    {
      label: 'Amount deviation',
      hint: 'This amount vs the shop’s typical',
      value: amount,
    },
  ];
  return (
    <Card
      title={<CardHeaderTitle icon={<Pulse />} text="Monitoring signals" badgeTone="purple" />}
      subtitle="Observations recorded at the time of this attempt."
    >
      <ul className="ad-signals">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="ad-signal__label">
              <strong>{row.label}</strong>
              <em>{row.hint}</em>
            </span>
            <span className="ad-signal__value">{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="ad-note">
        These are observations, not a score. Risk is evaluated only after correlating multiple
        attempts — no single number here judges this payment.
      </p>
    </Card>
  );
}

function RecentFromDevice({ rows }: { rows: AttemptDeviceRecent[] }): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Card
      title={
        <CardHeaderTitle
          icon={<Laptop />}
          text="Recent attempts from this device"
          badgeTone="blue"
        />
      }
      subtitle="Chronological attempt history on this device fingerprint."
      variant="flush"
    >
      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Payment ID</th>
              <th>Card</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.paymentId} className={row.isCurrent ? 'is-current' : undefined}>
                <td className="ad-muted">{new Date(row.at).toLocaleTimeString('en-IN')}</td>
                <td>
                  {row.isCurrent ? (
                    <code className="ad-code">{row.paymentId}</code>
                  ) : (
                    <Link
                      className="ad-link"
                      to="/console/attempts/$paymentId"
                      params={{ paymentId: row.paymentId }}
                    >
                      {row.paymentId}
                    </Link>
                  )}
                </td>
                <td>{row.cardNetwork !== null ? formatSentenceCase(row.cardNetwork) : '—'}</td>
                <td className="ad-amount">{rupees(row.amountPaise)}</td>
                <td>
                  <span className={`ad-chip ad-chip--${ROW_STATUS_TONE[row.status]}`}>
                    {ROW_STATUS_LABEL[row.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Context({ context }: { context: SensorContext | null }): React.JSX.Element | null {
  if (context === null) return null;
  return (
    <Card
      title={<CardHeaderTitle icon={<Laptop />} text="Checkout context" badgeTone="blue" />}
      subtitle="The storefront’s record of who was checking out."
    >
      <dl className="ad-facts ad-facts--sidebar">
        <Fact label="Session">
          <code className="ad-code">{context.sessionFingerprint}</code>
        </Fact>
        <Fact label="Device">
          <code className="ad-code">{context.deviceFingerprint}</code>
        </Fact>
        <Fact label="Network">
          <code className="ad-code">{context.ipFingerprint}</code>
        </Fact>
        <Fact label="Browser">{context.userAgentFamily}</Fact>
        <Fact label="Items in cart">{context.itemCount}</Fact>
      </dl>
      <p className="ad-note">
        These are keyed fingerprints — enough to tell two checkouts apart, never the values behind
        them.
      </p>
    </Card>
  );
}

export function AttemptDetailPage(): React.JSX.Element {
  const { paymentId } = useParams({ from: '/console/attempts/$paymentId' });
  const [activeTab, setActiveTab] = useState<'overview' | 'activity' | 'signals'>('overview');

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
  const deviceAttemptsCount = it.recentFromDevice ? it.recentFromDevice.length : 0;

  return (
    <div className="ad-page">
      <nav className="ad-breadcrumb" aria-label="Breadcrumb">
        <Link to="/console/attempts" className="ad-back">
          <ArrowLeft />
          <span>Back to attempts</span>
        </Link>
      </nav>

      <header className="ad-hero-banner">
        <div className="ad-hero__content">
          <div className="ad-hero__left">
            <div className="ad-hero__top">
              <span className={`ad-chip ad-chip--lg ad-chip--${STATUS_TONE[payment.status]}`}>
                {STATUS_LABEL[payment.status]}
              </span>
              <code className="ad-hero__id">{payment.paymentId}</code>
            </div>
            <div className="ad-hero__amount-row">
              <h1 className="ad-hero__amount">{rupees(payment.amountPaise)}</h1>
              <span className="ad-hero__currency">{payment.currency ?? 'INR'}</span>
            </div>
            <div className="ad-hero__meta">
              <MethodFactCell payment={payment} />
              <span className="ad-hero__sep">•</span>
              <span>{dateTime(payment.firstSeenAt)}</span>
              <span className="ad-hero__sep">•</span>
              <Badge tone={payment.source === 'replay' ? 'neutral' : 'info'}>
                {payment.source === 'replay' ? 'Simulation' : 'Live'}
              </Badge>
              <Badge tone="warn" dot>
                Test mode
              </Badge>
            </div>
          </div>

          {payment.failure !== null && (
            <div className="ad-hero__failure-highlight">
              <div className="ad-hero__failure-title">
                <span className="ad-hero__failure-dot" />
                <strong>
                  Payment Failed:{' '}
                  {payment.failure.description ?? payment.failure.reason ?? 'Declined'}
                </strong>
              </div>
              <p className="ad-hero__failure-sub">
                Declined by {payment.failure.source ?? 'bank'}
                {payment.failure.step ? ` during ${payment.failure.step}` : ''}
                {payment.failure.code ? ` · ${payment.failure.code}` : ''}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Enterprise Segmented Navigation Tabs */}
      <nav className="ad-nav-tabs" aria-label="Payment Detail Tabs">
        <button
          type="button"
          className={`ad-tab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <CreditCard />
          <span>Payment Overview</span>
        </button>
        <button
          type="button"
          className={`ad-tab-btn ${activeTab === 'activity' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          <Laptop />
          <span>Device Pulse</span>
        </button>
        <button
          type="button"
          className={`ad-tab-btn ${activeTab === 'signals' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('signals')}
        >
          <Pulse />
          <span>Risk Signals & Context</span>
        </button>
      </nav>

      {/* Tab Panel 1: Overview */}
      <div className={`ad-tab-panel ${activeTab === 'overview' ? 'is-active' : ''}`}>
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
      <div className={`ad-tab-panel ${activeTab === 'activity' ? 'is-active' : ''}`}>
        <div className="ad-grid ad-grid--single">
          <RecentFromDevice rows={it.recentFromDevice} />
        </div>
      </div>

      {/* Tab Panel 3: Risk Signals & Context */}
      <div className={`ad-tab-panel ${activeTab === 'signals' ? 'is-active' : ''}`}>
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
