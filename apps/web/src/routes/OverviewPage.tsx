import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EmptyState, Loading } from '@sentinel/ui';
import {
  overviewResponseSchema,
  auditListResponseSchema,
  policyResponseSchema,
  type AuditEntry,
  type IncidentSummary,
  type OverviewResponse,
  type PolicyResponse,
} from '@sentinel/contracts';
import {
  Siren,
  ShieldCheck,
  ClockCounterClockwise,
  ChartBar,
  CreditCard,
  TrendDown,
  ArrowsClockwise,
  ArrowsLeftRight,
  SealCheck,
  FileText,
  Play,
  Pause,
  ShieldSlash,
  UserCheck,
} from '@phosphor-icons/react';
import './OverviewPage.css';
import { timeAgo } from '../shared/time.js';
import { kindLabel } from '../incidents/audit-words.js';
import { RiskGauge } from '../components/RiskGauge.js';

/**
 * The Overview.
 *
 * Every number on this page is read from `/api/overview`, `/api/policy` or the audit chain, and
 * every caption under a number is derived from the same payload that produced it. Nothing is
 * padded: where a figure has no source — a "normal" approval rate to compare against, for
 * instance — the card says what it is actually counting instead of inventing a benchmark.
 */

type Source = 'all' | 'razorpay' | 'replay';
type WindowKey = 'today' | '7d' | '30d';

const RANGES: { key: WindowKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Week' },
  { key: '30d', label: 'Month' },
];

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return parse(await response.json());
}

const fetchOverview = (source: Source, range: WindowKey): Promise<OverviewResponse> =>
  getJson(`/api/overview?window=${range}&source=${source}`, (value) =>
    overviewResponseSchema.parse(value),
  );

const fetchPolicy = (): Promise<PolicyResponse> =>
  getJson('/api/policy', (value) => policyResponseSchema.parse(value));

const fetchAuditEntries = (): Promise<AuditEntry[]> =>
  getJson('/api/audit', (value) => auditListResponseSchema.parse(value).entries);

const clockAt = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

const dayAt = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * Describes the shape of the window's traffic from the trend itself.
 *
 * The bars used to be `Math.sin(index)` with three of them hardcoded tall, so the card drew the same
 * invented "burst" whatever the data said. This reads the real per-bucket counts: a run of buckets
 * carrying most of the volume is reported with its actual clock times, and traffic that is not
 * concentrated is described as spread out rather than dressed up as an event.
 */
function shapeOf(trend: OverviewResponse['riskTrend']): string {
  const active = trend.filter((point) => point.events > 0);
  if (active.length === 0) return 'no attempts in this window';

  const total = active.reduce((sum, point) => sum + point.events, 0);
  const peak = Math.max(...active.map((point) => point.events));
  const busy = (point: OverviewResponse['riskTrend'][number]): boolean =>
    point.events > 0 && point.events >= peak / 2;

  // The longest *contiguous* run of busy periods. Contiguity is the whole point: an earlier version
  // collected every busy bucket wherever it sat, so two separate spikes were reported as "one burst"
  // spanning the gap between them — a range in which most of the periods were empty.
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  trend.forEach((point, index) => {
    if (busy(point)) {
      if (runStart < 0) runStart = index;
      const length = index - runStart + 1;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  });

  const run = bestStart < 0 ? [] : trend.slice(bestStart, bestStart + bestLength);
  const runShare = run.reduce((sum, point) => sum + point.events, 0) / total;
  const spikes = trend.filter(busy).length;

  if (run.length > 0 && run.length <= 3 && runShare >= 0.6) {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const span = run.length === 1 ? clockAt(first.at) : `${clockAt(first.at)}–${clockAt(last.at)}`;
    return `one burst, ${span}`;
  }
  if (spikes > run.length && spikes <= 6) {
    return `${spikes} busy periods, spread across the window`;
  }
  return `spread across ${active.length} of ${trend.length} periods`;
}

/** The oldest incident still waiting on a person, or null when nothing is waiting. */
function oldestWaiting(incidents: IncidentSummary[]): IncidentSummary | null {
  const waiting = incidents.filter(
    (incident) => incident.status === 'open' || incident.status === 'under_review',
  );
  if (waiting.length === 0) return null;
  return waiting.reduce((oldest, incident) =>
    incident.detectedAt < oldest.detectedAt ? incident : oldest,
  );
}

export function OverviewPage(): React.JSX.Element {
  const [source] = useState<Source>('all');
  const [range, setRange] = useState<WindowKey>('today');

  /*
   * Two reads, deliberately.
   *
   * The figures across the top and the queue below them describe today, and they stay describing
   * today whichever range the chart is set to — one query drove both, so switching the chart to
   * Week silently rewrote "attempts today" and the incident counts into week totals under labels
   * that still said today.
   */
  const overview = useQuery({
    queryKey: ['overview', 'today', source],
    queryFn: () => fetchOverview(source, 'today'),
    refetchInterval: 8_000,
    placeholderData: keepPreviousData,
  });
  const chart = useQuery({
    queryKey: ['overview', range, source],
    queryFn: () => fetchOverview(source, range),
    refetchInterval: 8_000,
    placeholderData: keepPreviousData,
  });
  const policy = useQuery({ queryKey: ['policy'], queryFn: fetchPolicy });
  const audit = useQuery({ queryKey: ['audit-entries', 'overview'], queryFn: fetchAuditEntries });

  if (overview.isPending || policy.isPending || audit.isPending) {
    return (
      <div className="ov-page">
        <Loading label="Loading protection overview…" />
      </div>
    );
  }
  const data = overview.data;
  const live = policy.data;
  if (data === undefined || live === undefined) {
    return (
      <div className="ov-page">
        <EmptyState title="Overview unavailable" description="Could not load the dashboard." />
      </div>
    );
  }

  const waiting = oldestWaiting(data.recentIncidents);

  return (
    <div className="ov-page">
      <header className="ovp-head">
        <h1>Overview</h1>
        <p>Real-time protection for your payments</p>
      </header>

      {waiting !== null && <UnreviewedBanner incident={waiting} />}

      <KpiStrip data={data} waiting={waiting} />

      <div className="ovp-grid ovp-grid--main">
        <RecentIncidents incidents={data.recentIncidents} />
        <RiskActivity data={chart.data ?? data} range={range} onRange={setRange} />
      </div>

      <div className="ovp-grid ovp-grid--foot">
        <TopRiskReasons reasons={data.topRiskReasons} />
        <RecentActivity entries={audit.data ?? []} />
        <CurrentPolicy policy={live} />
      </div>
    </div>
  );
}

/** The single loudest thing still waiting on a person, surfaced above everything else. */
function UnreviewedBanner({ incident }: { incident: IncidentSummary }): React.JSX.Element {
  const facts = [
    incident.distinctCards !== null && incident.distinctCards > 0
      ? `${incident.distinctCards} cards`
      : null,
    `one ${incident.entityKind}`,
    `${timeAgo(incident.detectedAt)} old`,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="ov-alert" role="status">
      <Siren size={18} className="ov-alert__icon" />
      <span className="ov-alert__title">{incident.title} unreviewed</span>
      <span className="ov-alert__facts">{facts.join(' · ')}</span>
      <Link
        className="ov-alert__cta"
        to="/console/incidents/$id"
        params={{ id: incident.id }}
        aria-label={`Review ${incident.title}`}
      >
        Review incident
      </Link>
    </div>
  );
}

/** Attempts, with a sparkline whose bar heights are the real per-period counts. */
function AttemptsKpi({ data }: { data: OverviewResponse }): React.JSX.Element {
  const peak = Math.max(1, ...data.riskTrend.map((point) => point.events));
  return (
    <article className="ov-kpi">
      <h2 className="ov-kpi__label">Attempts today</h2>
      <p className="ov-kpi__value">
        {data.attemptsToday.toLocaleString('en-IN')} <span>payments</span>
      </p>
      {/* Bar heights are the real per-period counts behind the chart below. */}
      <div className="ov-spark" aria-hidden="true">
        {data.riskTrend.map((point) => (
          <span
            key={point.at}
            className="ov-spark__bar"
            style={{ height: `${Math.max(14, (point.events / peak) * 100)}%` }}
          />
        ))}
      </div>
      <p className="ov-kpi__foot">{shapeOf(data.riskTrend)}</p>
    </article>
  );
}

/**
 * Risk, laid out like its three neighbours: label, value, track, footnote.
 *
 * It used to be the odd one out — a row-flex card that centred its own content, so its label sat
 * lower than every other label in the strip and its footnote missed the shared baseline. It was
 * also the only card with nothing between the value and the footnote, which is what made the gap
 * read as a mistake rather than as breathing room.
 *
 * The gauge is the only thing here that draws the score. A progress track beside it was a second
 * drawing of the same number, and two meters for one value is one meter too many.
 *
 * The severity rode in a pill, which made this the only card in the strip with a badge in it, and
 * left a band of nothing between the value and the footnote. It is now the value's own qualifier,
 * exactly as "payments" and "of traffic" qualify the values either side of it, and the space that
 * freed up says where the score sits against the thresholds rather than sitting empty.
 */
function RiskKpi({ data }: { data: OverviewResponse }): React.JSX.Element {
  const tone = data.riskLevel === 'high' ? 'crit' : data.riskLevel === 'medium' ? 'warn' : 'ok';
  // This card used to read the policy's stepUp/contain thresholds and announce "Past the 85% block
  // line". Those thresholds are real, but `packages/policy/src/decide.ts` applies them to the
  // ATTACK HYPOTHESIS SUPPORT, not to this number — this is `max(incident.score)`, the rule sum.
  // An incident scoring 0.90 with attack support 0.60 would have been announced as past the block
  // line while the policy engine would only have stepped up. The card now reports the score it
  // actually has and says what decides the action, rather than predicting one it cannot compute.
  const stance = data.risk === null ? 'No open incident to score' : 'Highest-scoring open incident';

  return (
    <article className="ov-kpi ov-kpi--gauge">
      <h2 className="ov-kpi__label">Risk score</h2>

      <p className={`ov-kpi__value ov-kpi__value--${tone}`}>
        {data.risk === null ? '—' : `${Math.round(data.risk * 100)}%`}{' '}
        <span>{data.riskLevel ?? 'low'} risk</span>
      </p>

      <p className="ov-kpi__note">{stance}</p>

      <p className="ov-kpi__foot">
        Rules-based score. Containment is decided on the attack hypothesis, not on this number.
      </p>

      <div className="ov-gauge">
        <RiskGauge
          score={data.risk ?? 0}
          level={data.riskLevel}
          size="sm"
          hideBox
          hideReadout
          hideTitle
        />
      </div>
    </article>
  );
}

function KpiStrip({
  data,
  waiting,
}: {
  data: OverviewResponse;
  waiting: IncidentSummary | null;
}): React.JSX.Element {
  const settled = data.paymentsCaptured + data.paymentsFailed;
  const approval = settled === 0 ? null : (data.paymentsCaptured / settled) * 100;

  return (
    <section className="ov-kpis" aria-label="Key figures">
      <AttemptsKpi data={data} />

      <article className="ov-kpi">
        <h2 className="ov-kpi__label">Incidents</h2>
        <p className={`ov-kpi__value${data.activeIncidents > 0 ? ' ov-kpi__value--alert' : ''}`}>
          {data.activeIncidents} <span>to review</span>
        </p>
        <div className="ov-segs" aria-hidden="true">
          <span
            className="ov-segs__fill ov-segs__fill--alert"
            style={{
              width: `${data.totalIncidents === 0 ? 0 : (data.activeIncidents / data.totalIncidents) * 100}%`,
            }}
          />
        </div>
        <p className="ov-kpi__foot">
          {waiting === null
            ? 'All caught up · 0 waiting'
            : `Oldest: ${timeAgo(waiting.detectedAt)}`}
        </p>
      </article>

      <article className="ov-kpi">
        <h2 className="ov-kpi__label">Approval rate</h2>
        <p className="ov-kpi__value ov-kpi__value--ok">
          {approval === null ? '—' : `${approval.toFixed(1)}%`} <span>of traffic</span>
        </p>
        <div className="ov-segs" aria-hidden="true">
          <span
            className="ov-segs__fill ov-segs__fill--ok"
            style={{ width: `${approval ?? 0}%` }}
          />
        </div>
        <p className="ov-kpi__foot">
          {data.paymentsCaptured.toLocaleString('en-IN')} captured of{' '}
          {settled.toLocaleString('en-IN')}
        </p>
      </article>

      <RiskKpi data={data} />
    </section>
  );
}

/** Severity is what a reader needs first; the workflow status is secondary. */
/*
 * Status, in the status's own colour.
 *
 * An earlier pass tinted "Needs review" amber, which made an unreviewed critical incident look
 * mild. The colour follows what the row is asking of you: unreviewed is red because it wants a
 * decision, monitoring is amber because it is being watched, resolved is green because it is done.
 */
const STATUS_TONE: Record<string, string> = {
  open: 'crit',
  under_review: 'warn',
  contained: 'crit',
  resolved: 'ok',
  expired: 'muted',
};
const STATUS_WORD: Record<string, string> = {
  open: 'Needs review',
  under_review: 'Monitoring',
  contained: 'Contained',
  resolved: 'Resolved',
  expired: 'Expired',
};
const STATUS_ICON: Record<string, React.JSX.Element> = {
  open: <CreditCard size={13} />,
  under_review: <TrendDown size={13} />,
  contained: <ShieldSlash size={13} />,
  resolved: <ArrowsClockwise size={13} />,
  expired: <ArrowsClockwise size={13} />,
};

/**
 * The entity, short enough to read.
 *
 * The key is a 67-character pseudonymised hash; printed whole it swamped the row and told nobody
 * anything. The version prefix plus the first four characters distinguishes two entities, which is
 * all this line is for.
 */
function shortEntity(key: string): string {
  const [version, digest] = key.split(':');
  if (digest === undefined) return key.slice(0, 8);
  return `${version}:${digest.slice(0, 4)}`;
}

function RecentIncidents({ incidents }: { incidents: IncidentSummary[] }): React.JSX.Element {
  const counts = incidents.reduce<Record<string, number>>((acc, incident) => {
    acc[incident.status] = (acc[incident.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="ov-panel">
      <header className="ov-panel__head">
        <div>
          <h2>Recent incidents</h2>
          <p className="ov-panel__sub">Live detections requiring reviewer decision</p>
        </div>
        <Link className="ov-panel__more" to="/console/incidents">
          View all
        </Link>
      </header>

      {incidents.length === 0 ? (
        <p className="ov-panel__empty">Nothing detected in this window.</p>
      ) : (
        <ul className="ov-inc">
          {incidents.slice(0, 3).map((incident) => {
            const tone = STATUS_TONE[incident.status] ?? 'muted';
            return (
              <li className="ov-inc__row" key={incident.id}>
                <div className="ov-inc__top">
                  <span className={`ov-plate ov-plate--${tone}`} aria-hidden="true">
                    {STATUS_ICON[incident.status]}
                  </span>
                  <span className={`ov-pill ov-pill--${tone}`}>
                    {STATUS_WORD[incident.status] ?? incident.status}
                  </span>
                  <span className="ov-inc__when">{timeAgo(incident.detectedAt)}</span>
                </div>
                <Link
                  className="ov-inc__title"
                  to="/console/incidents/$id"
                  params={{ id: incident.id }}
                >
                  {incident.title}
                </Link>
                <div className="ov-inc__meta">
                  <span className="ov-inc__entity">
                    {incident.entityKind} <code>{shortEntity(incident.entityKey)}</code>
                  </span>
                  {incident.distinctCards !== null && incident.distinctCards > 0 && (
                    <span className="ov-inc__card-count">
                      {incident.distinctCards} {incident.distinctCards === 1 ? 'card' : 'cards'}
                    </span>
                  )}
                  <span className="ov-inc__score">
                    Score <strong>{incident.score.toFixed(2)}</strong>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="ov-panel__foot ov-inc__summary">
        {Object.entries(counts).length === 0
          ? 'No active incidents recorded in this window'
          : Object.entries(counts).map(([status, count]) => (
              <span key={status} className="ov-inc__count-chip">
                <strong>{count}</strong> {(STATUS_WORD[status] ?? status).toLowerCase()}
              </span>
            ))}
      </footer>
    </section>
  );
}

/**
 * Activity blocks.
 *
 * The problem here was never the chart type, it was the resolution. The window arrives as one point
 * per hour, so a day is twenty-five slots of which twenty-one are empty — and *any* form drawn over
 * that reads as a broken card: columns became two lonely spikes in a field of nothing, and a heat
 * ribbon only turned the emptiness into a row of grey.
 *
 * So the hours are grouped into a handful of wide blocks. At that resolution the ordinary column
 * chart everyone can already read finally works: every block carries traffic, the failed share sits
 * at the base of its own column, and each column is labelled with its own number, so there is no
 * axis to trace across the card to find out what a bar is worth.
 */

/** How much time one column covers, said in words: "3 hours", "one day". */
function columnWidth(trend: OverviewResponse['riskTrend'], columns: number): string {
  if (trend.length < 2 || columns === 0) return 'the whole window';
  const bucketMs = Math.abs(Date.parse(trend[1]!.at) - Date.parse(trend[0]!.at));
  const hours = Math.round((bucketMs * Math.ceil(trend.length / columns)) / 3_600_000);
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  if (hours >= 24) return 'one day';
  return hours === 1 ? 'one hour' : `${hours} hours`;
}

type Block = {
  key: string;
  label: string;
  span: string;
  from: number;
  to: number;
  attempts: number;
  failed: number;
  incidents: number;
  risk: number;
};

/**
 * Group the raw buckets into at most eight blocks.
 *
 * Eight is the point where a column is still wide enough to label on its cap. The grouping is a
 * plain division of the buckets, so every block covers the same span and none is a partial period
 * dressed up as a whole one.
 */
function blocksOf(trend: OverviewResponse['riskTrend']): Block[] {
  if (trend.length === 0) return [];
  const size = Math.max(1, Math.ceil(trend.length / 8));
  const spanMs =
    trend.length > 1 ? Math.abs(Date.parse(trend[1]!.at) - Date.parse(trend[0]!.at)) : 3_600_000;
  const daily = spanMs >= 86_400_000;
  const stamp = daily ? dayAt : clockAt;

  const blocks: Block[] = [];
  for (let start = 0; start < trend.length; start += size) {
    const slice = trend.slice(start, start + size);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    const from = Date.parse(first.at);
    blocks.push({
      key: first.at,
      // The axis gets the start time only — eight ranges side by side collided into each other
      // and became unreadable. The full span rides the readout and the caption under the chart.
      label: stamp(first.at),
      span: slice.length === 1 ? stamp(first.at) : `${stamp(first.at)}–${stamp(last.at)}`,
      from,
      to: Date.parse(last.at) + spanMs,
      attempts: slice.reduce((sum, point) => sum + point.events, 0),
      failed: slice.reduce((sum, point) => sum + point.failures, 0),
      incidents: slice.reduce((sum, point) => sum + point.incidents, 0),
      risk: Math.max(...slice.map((point) => point.risk)),
    });
  }
  return blocks;
}

function ActivityBlocks({
  trend,
  incidents,
}: {
  trend: OverviewResponse['riskTrend'];
  incidents: IncidentSummary[];
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const blocks = blocksOf(trend);
  const peak = Math.max(1, ...blocks.map((block) => block.attempts));

  const named = (block: Block): IncidentSummary[] =>
    incidents.filter(
      (incident) => incident.detectedAt >= block.from && incident.detectedAt < block.to,
    );

  // Ticks read top-down so they can be laid out in document order against the plot.
  const ticks = [peak, Math.round(peak / 2), 0];

  return (
    <div className="ov-blk">
      <div className="ov-blk__chart">
        {/* Laid out as a column of its own — same reserved strips, same track — so a tick lands on
            its gridline by construction rather than by a padding value kept in sync by hand. */}
        <div className="ov-blk__yaxis" aria-hidden="true">
          <span className="ov-blk__flag is-empty">—</span>
          <div className="ov-blk__ytrack">
            {ticks.map((tick, index) => (
              <span key={tick} style={{ top: `${index * 50}%` }}>
                {tick}
              </span>
            ))}
          </div>
          <span className="ov-blk__label" />
        </div>

        <div className="ov-blk__plot" onMouseLeave={() => setHover(null)}>
          {blocks.map((block, index) => {
            // The column is the attempt count; the failed part is a segment of it, never a second
            // column standing beside it, because a failure is one of those attempts and not an extra.
            const height = block.attempts === 0 ? 0 : (block.attempts / peak) * 100;
            const failedShare = block.attempts === 0 ? 0 : (block.failed / block.attempts) * 100;

            return (
              <div
                key={block.key}
                className={`ov-blk__col${hover === index ? ' is-hover' : ''}`}
                onMouseEnter={() => setHover(index)}
              >
                {/* Rendered even when empty so every column reserves the same strip above its
                  bar and the bars all start from one line. */}
                <span className={`ov-blk__flag${block.incidents === 0 ? ' is-empty' : ''}`}>
                  {block.incidents === 0
                    ? '—'
                    : `${block.incidents} incident${block.incidents === 1 ? '' : 's'}`}
                </span>

                <div className="ov-blk__track">
                  {block.attempts === 0 ? (
                    <span className="ov-blk__none" />
                  ) : (
                    <span className="ov-blk__bar" style={{ height: `${height}%` }}>
                      {block.failed > 0 && (
                        <span className="ov-blk__failed" style={{ height: `${failedShare}%` }} />
                      )}
                    </span>
                  )}
                </div>

                <span className="ov-blk__label">{block.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <BlockReadout
        block={hover === null ? undefined : blocks[hover]}
        named={hover === null ? [] : named(blocks[hover]!)}
        every={columnWidth(trend, blocks.length)}
      />
    </div>
  );
}

/** What the hovered block actually contained, in one fixed place under the columns. */
function BlockReadout({
  block,
  named,
  every,
}: {
  block: Block | undefined;
  named: IncidentSummary[];
  every: string;
}): React.JSX.Element {
  if (block === undefined) {
    return (
      <div className="ov-blk__readout">
        <span className="ov-blk__legend">
          <i className="ov-blk__key ov-blk__key--ok" /> Attempts
        </span>
        <span className="ov-blk__legend">
          <i className="ov-blk__key ov-blk__key--bad" /> Failed
        </span>
        <span className="ov-blk__legend">
          <i className="ov-blk__key ov-blk__key--inc" /> Incident raised
        </span>
        {/* The columns are labelled by where they start, so say out loud how wide one is. */}
        <span className="ov-blk__readout-name">Each column covers {every}</span>
      </div>
    );
  }

  const share = block.attempts > 0 ? Math.round((block.failed / block.attempts) * 100) : 0;

  return (
    <div className="ov-blk__readout" role="status" aria-live="polite">
      <strong className="ov-blk__readout-time">{block.span}</strong>
      <span>
        {block.attempts} attempt{block.attempts === 1 ? '' : 's'}
      </span>
      <span>
        {block.failed} failed{block.attempts > 0 && ` (${share}%)`}
      </span>
      <span>
        {block.incidents === 0
          ? 'no incident raised'
          : `${block.incidents} incident${block.incidents === 1 ? '' : 's'} · worst score ${block.risk.toFixed(2)}`}
      </span>
      {named.length > 0 && <span className="ov-blk__readout-name">{named[0]!.title}</span>}
    </div>
  );
}

function RiskActivity({
  data,
  range,
  onRange,
}: {
  data: OverviewResponse;
  range: WindowKey;
  onRange: (key: WindowKey) => void;
}): React.JSX.Element {
  const trend = data.riskTrend;
  const incidents = data.recentIncidents;

  return (
    <section className="ov-panel">
      <header className="ov-panel__head">
        <div>
          <h2>Risk & attempts activity</h2>
          <p className="ov-panel__sub">
            {data.totalIncidents} incident{data.totalIncidents === 1 ? '' : 's'} recorded ·{' '}
            {data.eventsAnalyzed.toLocaleString('en-IN')} attempts analyzed
          </p>
        </div>
        <div className="ov-range" role="group" aria-label="Time window">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`ov-range__btn${range === option.key ? ' is-active' : ''}`}
              aria-pressed={range === option.key}
              onClick={() => onRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {trend.length === 0 ? (
        <p className="ov-panel__empty">No activity to chart yet.</p>
      ) : (
        <ActivityBlocks trend={trend} incidents={incidents} />
      )}
    </section>
  );
}

function TopRiskReasons({
  reasons,
}: {
  reasons: OverviewResponse['topRiskReasons'];
}): React.JSX.Element {
  const total = reasons.reduce((sum, reason) => sum + reason.count, 0);
  const tones = ['crit', 'warn', 'info', 'ok', 'muted'];

  return (
    <section className="ov-panel">
      <header className="ov-panel__head">
        <div>
          <h2>
            <ChartBar size={15} /> Top risk reasons
          </h2>
          <p className="ov-panel__sub">{total} incidents categorized by trigger</p>
        </div>
      </header>

      {total === 0 ? (
        <p className="ov-panel__empty">No signals have fired in this window.</p>
      ) : (
        <div className="ov-reasons-wrap">
          <div className="ov-reasons__bar" aria-hidden="true">
            {reasons.map((reason, index) => (
              <span
                key={reason.code}
                className={`ov-reasons__seg ov-reasons__seg--${tones[index % tones.length]}`}
                style={{ flex: reason.count }}
              />
            ))}
          </div>
          <ul className="ov-reasons">
            {reasons.slice(0, 5).map((reason, index) => {
              const pct = Math.round((reason.count / total) * 100);
              return (
                <li key={reason.code} className="ov-reasons__item">
                  <div className="ov-reasons__left">
                    <span
                      className={`ov-dot ov-dot--${tones[index % tones.length]}`}
                      aria-hidden="true"
                    />
                    <span className="ov-reasons__name">{reason.code}</span>
                  </div>
                  <div className="ov-reasons__right">
                    <span className="ov-reasons__count">{reason.count}</span>
                    <span className="ov-reasons__pct">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <footer className="ov-panel__foot">Relative frequency of trigger signals</footer>
    </section>
  );
}

/** A glyph and tone for an audit kind, so a row is scannable without reading it. */
function activityIcon(kind: string): { icon: React.JSX.Element; tone: string } {
  if (kind.startsWith('incident')) return { icon: <ArrowsLeftRight size={13} />, tone: 'info' };
  if (kind.startsWith('policy.rev')) return { icon: <ArrowsClockwise size={13} />, tone: 'info' };
  if (kind.startsWith('policy.publish') || kind.startsWith('policy.submit'))
    return { icon: <SealCheck size={13} />, tone: 'ok' };
  if (kind.startsWith('policy')) return { icon: <FileText size={13} />, tone: 'muted' };
  if (kind.includes('resume') || kind.includes('activate') || kind.includes('approve'))
    return { icon: <Play size={13} />, tone: 'ok' };
  if (kind.includes('pause') || kind.includes('expire'))
    return { icon: <Pause size={13} />, tone: 'warn' };
  return { icon: <ShieldSlash size={13} />, tone: 'crit' };
}

function RecentActivity({ entries }: { entries: AuditEntry[] }): React.JSX.Element {
  // Newest first, whatever order the API returned them in.
  const latest = [...entries].sort((a, b) => b.seq - a.seq).slice(0, 5);

  return (
    <section className="ov-panel">
      <header className="ov-panel__head">
        <div>
          <h2>
            <ClockCounterClockwise size={15} /> Recent activity
          </h2>
          <p className="ov-panel__sub">Live stream from cryptographic audit chain</p>
        </div>
        <Link className="ov-panel__more" to="/console/audit">
          View all
        </Link>
      </header>

      {latest.length === 0 ? (
        <p className="ov-panel__empty">Nothing recorded yet.</p>
      ) : (
        <ul className="ov-act">
          {latest.map((entry) => {
            const look = activityIcon(entry.kind);
            return (
              <li className="ov-act__row" key={entry.seq}>
                <span className={`ov-plate ov-plate--${look.tone}`} aria-hidden="true">
                  {look.icon}
                </span>
                <div className="ov-act__info">
                  <span className="ov-act__what">{kindLabel(entry.kind)}</span>
                  <span className="ov-act__who">
                    {entry.actor ?? 'system'} · <code className="ov-act__seq">#{entry.seq}</code>
                  </span>
                </div>
                <span className="ov-act__when">{timeAgo(entry.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="ov-panel__foot">Immutable audit log · tamper-checked</footer>
    </section>
  );
}

function CurrentPolicy({ policy }: { policy: PolicyResponse }): React.JSX.Element {
  return (
    <section className="ov-panel">
      <header className="ov-panel__head">
        <div>
          <h2>
            <ShieldCheck size={15} /> Current policy
          </h2>
          <p className="ov-panel__sub">Live enforcement guardrails (Version {policy.version})</p>
        </div>
        <Link className="ov-panel__more" to="/console/policy">
          Manage
        </Link>
      </header>

      <div className="ov-policy-grid">
        <div className="ov-policy-tile">
          <span className="ov-policy-tile__label">Verify threshold</span>
          <span className="ov-policy-tile__value">
            {Math.round(policy.thresholds.stepUp * 100)}%
          </span>
          <span className="ov-policy-tile__sub">Step-up verification</span>
        </div>
        <div className="ov-policy-tile">
          <span className="ov-policy-tile__label">Block threshold</span>
          <span className="ov-policy-tile__value">
            {Math.round(policy.thresholds.contain * 100)}%
          </span>
          <span className="ov-policy-tile__sub">Automated containment</span>
        </div>
        <div className="ov-policy-tile">
          <span className="ov-policy-tile__label">Block duration</span>
          <span className="ov-policy-tile__value">{policy.containment.defaultMinutes} min</span>
          <span className="ov-policy-tile__sub">Standard containment cap</span>
        </div>
        <div className="ov-policy-tile">
          <span className="ov-policy-tile__label">Max per hour</span>
          <span className="ov-policy-tile__value">{policy.impactCaps.maxContainmentsPerHour}</span>
          <span className="ov-policy-tile__sub">Rate safety limit</span>
        </div>
      </div>

      <footer className="ov-panel__foot ov-policy__foot">
        <span className="ov-policy__note">
          <UserCheck size={14} /> Require approval before blocking
        </span>
        <span
          className={`ov-pill ov-pill--${policy.approval.containmentAlwaysNeedsApproval ? 'ok' : 'muted'}`}
        >
          {policy.approval.containmentAlwaysNeedsApproval ? 'Active' : 'Off'}
        </span>
      </footer>
    </section>
  );
}
