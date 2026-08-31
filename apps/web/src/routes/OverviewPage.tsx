import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EmptyState, Loading } from '@sentinel/ui';
import {
  overviewResponseSchema,
  systemHealthResponseSchema,
  type IncidentSummary,
  type OverviewResponse,
  type SystemHealthResponse,
} from '@sentinel/contracts';
import './OverviewPage.css';
import './AttemptsPage.css'; // import to share kpi card layout
import { RiskGauge } from '../components/RiskGauge.js';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import {
  CreditCard,
  Shield,
  LockKey,
  Laptop,
  TrendUp,
  Users,
  Flag,
  ArrowRight,
  CaretDown,
  ArrowsClockwise,
  ShieldCheck,
} from '@phosphor-icons/react';

type Source = 'all' | 'razorpay' | 'replay';
type WindowKey = '24h' | '7d' | '30d';

const WINDOW_OPTIONS: { id: WindowKey; label: string }[] = [
  { id: '24h', label: 'Today' },
  { id: '7d', label: 'This Week' },
  { id: '30d', label: 'This Month' },
];

const RANGE_NOUN: Record<WindowKey, string> = {
  '24h': 'today',
  '7d': 'this week',
  '30d': 'this month',
};
/** What the previous window is called, so a delta reads honestly for the range it compares. */
const PRIOR_NOUN: Record<WindowKey, string> = {
  '24h': 'yesterday',
  '7d': 'last week',
  '30d': 'last month',
};
const RISK_SUBTITLE: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low risk',
  medium: 'Elevated activity',
  high: 'High risk',
};

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return parse(await response.json());
}

const fetchOverview = (source: Source, range: WindowKey): Promise<OverviewResponse> =>
  getJson(`/api/overview?window=${range}&source=${source}`, (value) =>
    overviewResponseSchema.parse(value),
  );
const fetchSystem = (): Promise<SystemHealthResponse> =>
  getJson('/api/system/health', (value) => systemHealthResponseSchema.parse(value));

function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** The attempts delta, straight from the backend — or an honest "no baseline" when it is null. */
function AttemptsDelta({
  pct,
  range,
}: {
  pct: number | null;
  range: WindowKey;
}): React.JSX.Element {
  if (pct === null) {
    return <span className="ov-stat-sub">No {PRIOR_NOUN[range]} to compare</span>;
  }
  const up = pct >= 0;
  const magnitude = Math.round(Math.abs(pct) * 1000) / 10;
  return (
    <span className={`ov-delta ov-delta--${up ? 'up' : 'down'}`}>
      {up ? <>&uarr;</> : <>&darr;</>} {magnitude}% vs {PRIOR_NOUN[range]}
    </span>
  );
}

/** The system-health pill, reflecting the real shedding state — never a hardcoded "healthy". */
function healthPill(system: UseQueryResult<SystemHealthResponse>): { label: string; ok: boolean } {
  if (system.isPending) return { label: 'Checking system…', ok: true };
  if (system.isError || system.data === undefined) {
    return { label: 'System status unavailable', ok: false };
  }
  const shedding = system.data.health.shedding;
  return shedding.length === 0
    ? { label: 'System healthy', ok: true }
    : {
        label: `Degraded — shedding ${shedding.length} tier${shedding.length === 1 ? '' : 's'}`,
        ok: false,
      };
}

/** Evenly-spaced real timestamps from the trend, for the x-axis — never fixed placeholder ticks. */
function axisLabels(trend: OverviewResponse['riskTrend'], range: WindowKey): string[] {
  if (trend.length === 0) return [];
  const fmt = (iso: string): string => {
    const date = new Date(iso);
    return range === '24h'
      ? date.toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true })
      : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  const positions = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (trend.length - 1)));
  return [...new Set(positions)].map((index) => fmt(trend[index]!.at));
}

function RiskTrendChart({
  trend,
  range,
  onWindow,
}: {
  trend: OverviewResponse['riskTrend'];
  range: WindowKey;
  onWindow: (value: WindowKey) => void;
}): React.JSX.Element {
  // Map each real bucket to the chart: risk 0 sits on the baseline (y=86), risk 1 near the top (y=18).
  const points = trend.map((point, index) => ({
    x: trend.length <= 1 ? 50 : (index / (trend.length - 1)) * 100,
    y: 86 - point.risk * 68,
    risk: point.risk,
  }));
  const hasActivity = trend.some((point) => point.risk > 0);
  const line = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(' ');
  const area = line === '' ? '' : `${line} L 100,98 L 0,98 Z`;
  const labels = axisLabels(trend, range);

  return (
    <section className="ov-card ov-panel ov-trend-card">
      <div className="ov-panel-header">
        <h2>Risk activity over time</h2>
        <CustomSelectPill
          value={range}
          options={WINDOW_OPTIONS.map((opt) => ({
            value: opt.id,
            label: opt.label,
          }))}
          onChange={(val) => onWindow(val as WindowKey)}
          ariaLabel="Time range"
        />
      </div>
      <div className="ov-chart-container">
        <div className="ov-chart-y-axis">
          <span>High</span>
          <span>Medium</span>
          <span>Low</span>
        </div>
        <div className="ov-chart-body">
          <div className="ov-chart-grid-lines">
            <div className="ov-grid-line" />
            <div className="ov-grid-line" />
            <div className="ov-grid-line" />
          </div>
          {hasActivity ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ov-chart-svg">
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0b72e7" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#0b72e7" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#chartGradient)" />
              <path
                d={line}
                fill="none"
                stroke="#0b72e7"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : (
            <div className="ov-chart-empty">No elevated risk in this window.</div>
          )}
        </div>
      </div>
      <div className="ov-chart-x-axis">
        {labels.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          labels.map((label, i) => <span key={i}>{label}</span>)
        )}
      </div>
    </section>
  );
}

function badgeToneClass(severity: string, score: number): string {
  if (severity === 'high' && score >= 0.9) return 'ov-badge--critical';
  if (severity === 'high') return 'ov-badge--high';
  if (severity === 'medium') return 'ov-badge--medium';
  return 'ov-badge--low';
}

function statusPillClass(incident: IncidentSummary): { label: string; tone: string } {
  switch (incident.status) {
    case 'open':
      return incident.recommendedDecision === 'monitor'
        ? { label: 'Monitoring', tone: 'monitoring' }
        : { label: 'Needs review', tone: 'needs-review' };
    case 'under_review':
      return { label: 'Reviewing', tone: 'reviewing' };
    case 'contained':
      return { label: 'Contained', tone: 'resolved' };
    case 'resolved':
      return { label: 'Resolved', tone: 'resolved' };
    default:
      return { label: 'Closed', tone: 'neutral' };
  }
}

function cardsPhrase(count: number | null): string {
  if (count === null || count <= 0) return '';
  return ` · ${count} ${count === 1 ? 'card' : 'cards'}`;
}

function RecentIncidentsSection({
  incidents,
}: {
  incidents: OverviewResponse['recentIncidents'];
}): React.JSX.Element {
  const items = incidents.slice(0, 5);

  return (
    <section className="ov-card ov-panel ov-incidents-card">
      <div className="ov-panel-header">
        <h2>Recent incidents</h2>
        <Link to="/console/incidents" className="ov-link-all">
          View all
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon="🛡"
          title="No incidents"
          description="Incidents appear when the detector correlates suspicious activity."
        />
      ) : (
        <ul className="ov-incident-list">
          {items.map((inc) => {
            const pill = statusPillClass(inc);
            const badgeClass = badgeToneClass(inc.severity, inc.score);
            const badgeText =
              inc.severity === 'high' && inc.score >= 0.9 ? 'CRITICAL' : inc.severity.toUpperCase();

            return (
              <li key={inc.id}>
                <Link
                  to="/console/incidents/$id"
                  params={{ id: inc.id }}
                  className="ov-incident-row"
                >
                  <span className={`ov-badge ${badgeClass}`}>{badgeText}</span>
                  <div className="ov-incident-info">
                    <strong className="ov-incident-title">{inc.title}</strong>
                    <span className="ov-incident-meta">
                      {Math.round(inc.score * 100)}% risk · {inc.attempts} attempts
                      {cardsPhrase(inc.distinctCards)} · {timeAgo(inc.detectedAt)}
                    </span>
                  </div>
                  <span className={`ov-status-pill ov-status-pill--${pill.tone}`}>
                    {pill.label}
                  </span>
                  <ArrowRight />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ProtectionFlowSection(): React.JSX.Element {
  const steps = [
    {
      num: '1',
      title: 'Detect',
      desc: 'We analyze every payment in real time',
      icon: <Shield color="#0b72e7" />,
    },
    { num: '2', title: 'Score', desc: 'Rules, behavior and ML assess risk', icon: <Users /> },
    { num: '3', title: 'Decide', desc: 'Policy determines the best response', icon: <Flag /> },
    {
      num: '4',
      title: 'Act',
      desc: 'Review, contain or monitor suspicious activity',
      icon: <LockKey />,
    },
    { num: '5', title: 'Learn', desc: 'Outcomes improve future detection', icon: <TrendUp /> },
  ];

  return (
    <section className="ov-card ov-panel ov-flow-card">
      <div className="ov-panel-header">
        <h2>How Sentinel protects you</h2>
      </div>
      <div className="ov-flow-steps">
        <div className="ov-flow-line" />
        {steps.map((step) => (
          <div key={step.num} className="ov-flow-step">
            <div className="ov-flow-icon-bubble">{step.icon}</div>
            <strong className="ov-flow-step-title">
              {step.num}. {step.title}
            </strong>
            <p className="ov-flow-step-desc">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const REASON_COLORS = ['#F04438', '#F79009', '#F59E0B', '#7A5AF8', '#2E90FA'];
const REASON_ICONS = [<Shield color="#F04438" />, <Laptop />, <TrendUp />, <LockKey />, <Flag />];

function RiskReasonsSection({
  reasons,
}: {
  reasons: OverviewResponse['topRiskReasons'];
}): React.JSX.Element {
  const total = reasons.reduce((acc, r) => acc + r.count, 0);

  return (
    <section className="ov-card ov-panel ov-reasons-card">
      <div className="ov-panel-header">
        <h2>Top risk reasons</h2>
        <Link to="/console/incidents" className="ov-link-all">
          View all
        </Link>
      </div>
      {reasons.length === 0 ? (
        <EmptyState
          title="No risk drivers yet"
          description="Reasons appear here once the detector opens incidents — each one grouped by what it was."
        />
      ) : (
        <div className="ov-reasons-list">
          {reasons.map((item, index) => {
            const pct = total === 0 ? 0 : Math.round((item.count / total) * 100);
            const color = REASON_COLORS[index % REASON_COLORS.length];
            const icon = REASON_ICONS[index % REASON_ICONS.length];

            return (
              <div key={item.code} className="ov-reason-row">
                <div className="ov-reason-left">
                  <div className="ov-reason-icon" style={{ color }}>
                    {icon}
                  </div>
                  <span className="ov-reason-name">{item.code}</span>
                </div>
                <div className="ov-reason-right">
                  <div className="ov-reason-bar-bg">
                    <div
                      className="ov-reason-bar-fill"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="ov-reason-pct">{item.count}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OverviewHeader(): React.JSX.Element {
  return (
    <header className="ov-header-hero">
      <div className="ov-header-title-group">
        <h1>Overview</h1>
        <p className="ov-header-subtitle">Real-time protection for your payments</p>
      </div>
    </header>
  );
}

function OverviewStats({
  data,
  range,
}: {
  data: OverviewResponse;
  range: WindowKey;
}): React.JSX.Element {
  return (
    <div className="ap-kpis">
      <article className="ap-kpi ap-kpi--total">
        <span
          className="ap-kpi__icon"
          aria-hidden="true"
          style={{ color: '#0b72e7', backgroundColor: 'rgba(11, 114, 231, 0.1)' }}
        >
          <CreditCard />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Attempts Today</span>
          <strong className="ap-kpi__value">{data.attemptsToday.toLocaleString('en-IN')}</strong>
          <div className="ap-kpi__subtext">
            <AttemptsDelta pct={data.attemptsDeltaPct} range={range} />
          </div>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--failed">
        <span
          className="ap-kpi__icon"
          aria-hidden="true"
          style={{ color: '#dc2626', backgroundColor: 'rgba(220, 38, 38, 0.1)' }}
        >
          <Shield />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Incidents Needing Review</span>
          <strong className="ap-kpi__value">{data.activeIncidents}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--slate">
            {data.underReview} already in review
          </span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--authorized">
        <span
          className="ap-kpi__icon"
          aria-hidden="true"
          style={{ color: '#0b72e7', backgroundColor: 'rgba(11, 114, 231, 0.1)' }}
        >
          <LockKey />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Active Containments</span>
          <strong className="ap-kpi__value">{data.contained}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--slate">
            {data.contained === 0 ? 'None enforced right now' : 'Currently enforced'}
          </span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--captured">
        <span
          className="ap-kpi__icon"
          aria-hidden="true"
          style={{ color: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.1)' }}
        >
          <TrendUp />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Total Incidents</span>
          <strong className="ap-kpi__value">{data.totalIncidents}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--blue">
            Resolved: {data.resolvedToday}
          </span>
        </div>
      </article>

      <article className="ap-kpi ap-kpi--safe">
        <span
          className="ap-kpi__icon"
          aria-hidden="true"
          style={{ color: '#0E5700', backgroundColor: 'rgba(14, 87, 0, 0.1)' }}
        >
          <ShieldCheck />
        </span>
        <div className="ap-kpi__body">
          <span className="ap-kpi__label">Events Analyzed</span>
          <strong className="ap-kpi__value">{data.eventsAnalyzed.toLocaleString('en-IN')}</strong>
          <span className="ap-kpi__subtext ap-kpi__subtext--blue">Real-time protection</span>
        </div>
      </article>
    </div>
  );
}

export function OverviewPage(): React.JSX.Element {
  const [source] = useState<Source>('all');
  const [range, setRange] = useState<WindowKey>('24h');

  const overview = useQuery({
    queryKey: ['overview', range, source],
    queryFn: () => fetchOverview(source, range),
    refetchInterval: 8_000,
    placeholderData: keepPreviousData,
  });

  const system = useQuery({
    queryKey: ['system-health', 'overview'],
    queryFn: fetchSystem,
    refetchInterval: 15_000,
  });

  if (overview.isPending) {
    return (
      <div className="ov-page-wrapper">
        <Loading label="Loading protection overview…" />
      </div>
    );
  }

  if (overview.data === undefined) {
    return (
      <div className="ov-page-wrapper">
        <EmptyState title="Overview unavailable" description="Could not load the dashboard." />
      </div>
    );
  }

  const data = overview.data;

  return (
    <div className="ov-page-wrapper">
      <OverviewHeader />

      <OverviewStats data={data} range={range} />

      <div className="ov-middle-grid">
        <RiskTrendChart trend={data.riskTrend} range={range} onWindow={setRange} />
        <RecentIncidentsSection incidents={data.recentIncidents} />
      </div>

      <div className="ov-bottom-grid">
        <ProtectionFlowSection />
        <RiskReasonsSection reasons={data.topRiskReasons} />
      </div>
    </div>
  );
}
