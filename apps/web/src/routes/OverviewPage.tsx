import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge, EmptyState, ErrorState, Loading } from '@sentinel/ui';
import {
  overviewResponseSchema,
  riskModelMetricsResponseSchema,
  systemHealthResponseSchema,
  type OverviewResponse,
  type RiskModelMetrics,
  type RiskModelMetricsResponse,
  type SystemHealthResponse,
} from '@sentinel/contracts';
import { useSession } from '../auth/useSession.js';
import './OverviewPage.css';

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return parse(await response.json());
}

const fetchOverview = (): Promise<OverviewResponse> =>
  getJson('/api/overview?window=24h', (value) => overviewResponseSchema.parse(value));
const fetchModel = (): Promise<RiskModelMetricsResponse> =>
  getJson('/api/model/metrics', (value) => riskModelMetricsResponseSchema.parse(value));
const fetchSystem = (): Promise<SystemHealthResponse> =>
  getJson('/api/system/health', (value) => systemHealthResponseSchema.parse(value));

type Honest = RiskModelMetrics['honest'];
const pct = (value: number): string => `${Math.round(value * 100)}%`;
const rupees = (paise: number | null): string =>
  paise === null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`;

function level(value: number): { label: string; tone: 'ok' | 'warn' | 'critical' } {
  return value >= 0.5
    ? { label: 'High', tone: 'critical' }
    : value >= 0.2
      ? { label: 'Medium', tone: 'warn' }
      : { label: 'Low', tone: 'ok' };
}

function IconCircle({ icon, tone }: { icon: string; tone: string }): React.JSX.Element {
  return (
    <span className={`ov-icon ov-icon--${tone}`} aria-hidden="true">
      {icon}
    </span>
  );
}

function Stat({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: string;
  tone: string;
  label: string;
  value: string | number;
  hint: string;
}): React.JSX.Element {
  return (
    <article className="ov-stat">
      <div className="ov-stat__head">
        <IconCircle icon={icon} tone={tone} />
        <span>{label}</span>
      </div>
      <strong className="ov-stat__value">{value}</strong>
      <span className="ov-stat__hint">{hint}</span>
    </article>
  );
}

function RiskGauge({
  risk,
  riskLevel,
}: {
  risk: number | null;
  riskLevel: OverviewResponse['riskLevel'];
}): React.JSX.Element {
  if (risk === null) {
    return (
      <section className="ov-panel ov-gauge-panel">
        <div className="ov-panel__title">
          <h2>Risk level</h2>
        </div>
        <div className="ov-gauge ov-gauge--empty" aria-label="No recent risk activity">
          <svg viewBox="0 0 220 125" role="img" aria-hidden="true">
            <path className="ov-gauge__track" pathLength="100" d="M25 105 A85 85 0 0 1 195 105" />
          </svg>
          <strong>No recent risk activity</strong>
        </div>
        <p className="ov-muted">No live incidents in the selected window.</p>
      </section>
    );
  }
  const current = riskLevel
    ? {
        label: riskLevel,
        tone:
          riskLevel === 'high'
            ? ('critical' as const)
            : riskLevel === 'medium'
              ? ('warn' as const)
              : ('ok' as const),
      }
    : level(risk);
  const dash = Math.max(8, Math.round(Math.min(risk, 1) * 100));
  return (
    <section className="ov-panel ov-gauge-panel">
      <div className="ov-panel__title">
        <h2>Risk level</h2>
        <span className={`ov-level ov-level--${current.tone}`}>{current.label}</span>
      </div>
      <div className="ov-gauge" aria-label={`${current.label} risk level`}>
        <svg viewBox="0 0 220 125" role="img" aria-hidden="true">
          <path className="ov-gauge__track" pathLength="100" d="M25 105 A85 85 0 0 1 195 105" />
          <path
            className={`ov-gauge__value ov-gauge__value--${current.tone}`}
            pathLength="100"
            strokeDasharray={`${dash} 100`}
            d="M25 105 A85 85 0 0 1 195 105"
          />
        </svg>
        <strong>{current.label}</strong>
        <span>{risk < 0.2 ? 'Normal traffic' : 'Needs attention'}</span>
      </div>
      <p className="ov-muted">Highest detected incident risk in the last 24 hours.</p>
    </section>
  );
}

function RiskTrend({ trend }: { trend: OverviewResponse['riskTrend'] }): React.JSX.Element {
  const hasActivity = trend.some((point) => point.events > 0);
  const points = hasActivity ? trend : [];
  const max = Math.max(...points.map((point) => point.risk), 0.01);
  const coords = points
    .map(
      (point, index) =>
        `${(index / Math.max(points.length - 1, 1)) * 100},${92 - (point.risk / max) * 72}`,
    )
    .join(' ');
  return (
    <section className="ov-panel ov-trend">
      <div className="ov-panel__title">
        <div>
          <h2>Risk over time</h2>
          <p>Risk activity from detected live incidents</p>
        </div>
        <select aria-label="Risk time range" defaultValue="24h">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
        </select>
      </div>
      <div className={`ov-chart${hasActivity ? '' : ' ov-chart--empty'}`}>
        <div className="ov-chart__labels">
          <span>High</span>
          <span>Medium</span>
          <span>Low</span>
        </div>
        {hasActivity ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label="Risk signal trend"
          >
            <path className="ov-chart__area" d={`M ${coords} L 100,100 L 0,100 Z`} />
            <polyline className="ov-chart__line" points={coords} />
          </svg>
        ) : (
          <p>No recent activity</p>
        )}
      </div>
      <div className="ov-chart__axis">
        <span>24h ago</span>
        <span>12h ago</span>
        <span>Now</span>
      </div>
    </section>
  );
}

const eventTone = (status: string | null): 'ok' | 'warn' | 'critical' =>
  status === 'failed' ? 'critical' : status === 'captured' ? 'ok' : 'warn';

function RecentEvents({ events }: { events: OverviewResponse['recentEvents'] }): React.JSX.Element {
  return (
    <section className="ov-panel ov-recent">
      <div className="ov-panel__title">
        <div>
          <h2>Recent events</h2>
          <p>Live Razorpay activity · replay traffic excluded</p>
        </div>
        <Link to="/console/attempts">View all →</Link>
      </div>
      {events.length === 0 ? (
        <EmptyState
          icon="—"
          title="No live events yet"
          description="Complete a test-mode storefront checkout to see it here."
        />
      ) : (
        <div className="ov-event-list">
          {events.slice(0, 6).map((event) => (
            <div className="ov-event" key={event.id}>
              <IconCircle
                icon={event.status === 'failed' ? '−' : event.status === 'captured' ? '✓' : '·'}
                tone={eventTone(event.status)}
              />
              <div className="ov-event__copy">
                <strong>
                  {event.status === 'failed'
                    ? 'Payment failed'
                    : event.status === 'captured'
                      ? 'Payment captured'
                      : event.eventType}
                </strong>
                <span>
                  {event.orderId ?? 'No order id'} · {rupees(event.amountPaise)}
                </span>
              </div>
              <Badge tone={eventTone(event.status)} size="sm">
                {event.status === 'failed'
                  ? 'Review'
                  : event.status === 'captured'
                    ? 'Safe'
                    : 'Pending'}
              </Badge>
              <time>
                {new Date(event.eventAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const incidentTone = (severity: 'low' | 'medium' | 'high'): 'ok' | 'warn' | 'critical' =>
  severity === 'high' ? 'critical' : severity === 'medium' ? 'warn' : 'ok';

function RecentIncidents({
  incidents,
}: {
  incidents: OverviewResponse['recentIncidents'];
}): React.JSX.Element {
  return (
    <section className="ov-panel ov-recent">
      <div className="ov-panel__title">
        <div>
          <h2>Recent incidents</h2>
          <p>Correlated suspicious activity · live Razorpay only</p>
        </div>
        <Link to="/console/incidents">View all →</Link>
      </div>
      {incidents.length === 0 ? (
        <EmptyState
          icon="✓"
          title="No live incidents"
          description="Incidents will appear when the detector correlates suspicious activity."
        />
      ) : (
        <div className="ov-event-list">
          {incidents.slice(0, 5).map((incident) => (
            <Link
              className="ov-event ov-incident"
              key={incident.id}
              to="/console/incidents/$id"
              params={{ id: incident.id }}
            >
              <IconCircle icon="!" tone={incidentTone(incident.severity)} />
              <div className="ov-event__copy">
                <strong>{incident.primaryHypothesis.replaceAll('_', ' ')}</strong>
                <span>
                  {incident.entityKind} · {incident.observations} observations · score{' '}
                  {incident.score.toFixed(2)}
                </span>
              </div>
              <Badge tone={incidentTone(incident.severity)} size="sm">
                {incident.recommendedDecision}
              </Badge>
              <time>
                {new Date(incident.detectedAt).toLocaleDateString([], {
                  day: '2-digit',
                  month: 'short',
                })}
              </time>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ProtectionFlow(): React.JSX.Element {
  const steps = [
    ['◈', 'Detect', 'Observe each checkout and Razorpay event'],
    ['⌁', 'Score', 'Rules, features and ML weigh evidence'],
    ['◇', 'Decide', 'Policy controls the permitted response'],
    ['▣', 'Act', 'Review and reversible containment'],
    ['▥', 'Learn', 'Analyst verdicts improve scoring'],
  ];
  return (
    <section className="ov-panel ov-flow">
      <div className="ov-panel__title">
        <div>
          <h2>How Sentinel protects you</h2>
          <p>One transparent path from event to accountable action</p>
        </div>
      </div>
      <div className="ov-flow__steps">
        {steps.map(([icon, title, copy], index) => (
          <div className="ov-flow__step" key={title}>
            <span className="ov-flow__icon">{icon}</span>
            <b>
              {index + 1}. {title}
            </b>
            <p>{copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RiskReasons({
  reasons,
}: {
  reasons: OverviewResponse['topRiskReasons'];
}): React.JSX.Element {
  const total = reasons.reduce((sum, reason) => sum + reason.count, 0) || 1;
  return (
    <section className="ov-panel ov-reasons">
      <div className="ov-panel__title">
        <div>
          <h2>Top risk reasons</h2>
          <p>Evidence codes from live incidents</p>
        </div>
        <Link to="/console/incidents">View all →</Link>
      </div>
      {reasons.length === 0 ? (
        <p className="ov-muted">No risk activity detected</p>
      ) : (
        reasons.map((reason) => (
          <div className="ov-reason" key={reason.code}>
            <div>
              <span>{reason.code.replaceAll('_', ' ')}</span>
              <b>{Math.round((reason.count / total) * 100)}%</b>
            </div>
            <div className="ov-reason__bar">
              <i style={{ width: `${Math.max(8, (reason.count / total) * 100)}%` }} />
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function LiveFooter({
  overview,
  system,
}: {
  overview: OverviewResponse | undefined;
  system: SystemHealthResponse | undefined;
}): React.JSX.Element {
  const healthy = system?.health !== undefined;
  return (
    <section className="ov-live-footer">
      <IconCircle icon="✦" tone="accent" />
      <div>
        <strong>
          {healthy
            ? 'Sentinel is monitoring your checkout'
            : 'Sentinel is connecting to the protection pipeline'}
        </strong>
        <span>
          {overview
            ? `Verified ${overview.attemptsToday} Razorpay payment attempts in the last 24 hours.`
            : 'Live event data will appear here after the first webhook is received.'}
        </span>
      </div>
      <Link to="/console/attempts">View attempts →</Link>
    </section>
  );
}

// The page is intentionally kept as one composition so the dashboard structure is easy to scan.
// eslint-disable-next-line max-lines-per-function
export function OverviewPage(): React.JSX.Element {
  const overview = useQuery({
    queryKey: ['overview', '24h'],
    queryFn: fetchOverview,
    refetchInterval: 10_000,
  });
  const model = useQuery({ queryKey: ['model-metrics'], queryFn: fetchModel });
  const system = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystem,
    refetchInterval: 15_000,
  });
  const metrics: Honest | null = model.data?.available === true ? model.data.model.honest : null;
  const { user } = useSession();

  if (overview.isPending)
    return (
      <div className="ov-page">
        <Loading label="Loading protection overview…" />
      </div>
    );
  if (overview.isError)
    return (
      <div className="ov-page">
        <ErrorState message={overview.error.message} />
      </div>
    );
  if (overview.data === undefined)
    return (
      <div className="ov-page">
        <ErrorState message="Overview data is unavailable" />
      </div>
    );

  const data = overview.data;
  const risk = data.risk;

  return (
    <div className="ov-page">
      <header className="ov-hero">
        <div>
          <p className="ov-eyebrow">Monitor · live protection</p>
          <h1>Overview</h1>
          <p>Real-time protection for your Razorpay payments</p>
        </div>
        <div className="ov-hero__right">
          <button type="button" className="ov-notification" aria-label="Notifications">
            ♧
          </button>
          <span className="ov-merchant">{user?.displayName ?? 'Merchant workspace'}</span>
          <span className="ov-health">
            <i /> {system.data ? 'System healthy' : 'Checking system'}
          </span>
          <span className="ov-updated">
            Last updated{' '}
            {new Date(data.generatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </header>
      <div className="ov-stats">
        <Stat
          icon="✦"
          tone="accent"
          label="Attempts today"
          value={data.attemptsToday}
          hint="payment attempts"
        />
        <Stat
          icon="−"
          tone="critical"
          label="Active containments"
          value={data.contained}
          hint="active protections"
        />
        <Stat
          icon="◷"
          tone="warn"
          label="Incidents needing review"
          value={data.activeIncidents}
          hint="waiting for review"
        />
        <Stat
          icon="✓"
          tone="ok"
          label="Total incidents"
          value={data.totalIncidents}
          hint="in selected window"
        />
        <RiskGauge risk={risk} riskLevel={data.riskLevel} />
      </div>
      <div className="ov-main-grid">
        <RiskTrend trend={data.riskTrend} />
        <RecentEvents events={data.recentEvents} />
      </div>
      <div className="ov-case-grid">
        <RecentIncidents incidents={data.recentIncidents} />
      </div>
      <div className="ov-lower-grid">
        <ProtectionFlow />
        <RiskReasons reasons={data.topRiskReasons} />
      </div>
      <div className="ov-insight-grid">
        <section className="ov-panel ov-insight">
          <div>
            <h2>Detection posture</h2>
            <p>
              Rules, statistical change detection and the deployed model work together. High-risk
              cases remain approval-gated.
            </p>
          </div>
          <div className="ov-insight__stats">
            <span>
              <b>{data.activeIncidents}</b> active incidents
            </span>
            <span>
              <b>{metrics ? pct(metrics.recall.point) : '—'}</b> model recall
            </span>
          </div>
          <Link to="/console/metrics">Explore model →</Link>
        </section>
        <LiveFooter overview={data} system={system.data} />
      </div>
    </div>
  );
}
