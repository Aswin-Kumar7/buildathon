import type { IncidentSummary } from '@sentinel/contracts';

export type Bucket = 'critical' | 'high' | 'medium' | 'low';

/**
 * The reference shows a Critical tier; the backend severity is three-level {low, medium, high}. This
 * reuses the product's existing convention (a high-severity incident at score >= 0.9 reads as
 * critical) rather than inventing a fourth stored tier. Purely a display grouping of real values.
 */
export function bucketOf(incident: IncidentSummary): Bucket {
  if (incident.severity === 'high') return incident.score >= 0.9 ? 'critical' : 'high';
  return incident.severity;
}

/** `all` is the resting state — the tile that clears whatever filter is set. */
export type SummaryKey = Bucket | 'resolved' | 'all';

const CARDS: { key: SummaryKey; label: string; tone: string; hint: string }[] = [
  {
    key: 'all',
    label: 'Total incidents',
    tone: 'total',
    hint: 'Every incident in the queue, whatever its severity or status.',
  },
  {
    key: 'critical',
    label: 'Critical',
    tone: 'critical',
    hint: 'High severity scoring 90 or above — the ones worth looking at first.',
  },
  { key: 'high', label: 'High', tone: 'high', hint: 'High severity, scoring below 90.' },
  { key: 'medium', label: 'Medium', tone: 'medium', hint: 'Medium severity.' },
  { key: 'low', label: 'Low', tone: 'low', hint: 'Low severity.' },
  {
    key: 'resolved',
    label: 'Resolved',
    tone: 'resolved',
    hint: 'Closed incidents. Counted apart from the severity tiers, never inside them.',
  },
];

/**
 * The tier cards double as the fastest triage filter: each one is a button that narrows the table to
 * its own tier (or clears itself when it is already the active filter), so a merchant scanning the
 * queue can jump straight to what needs attention. Counts are real — non-resolved, non-expired
 * incidents per bucket, and closed incidents under Resolved.
 *
 * Laid out exactly like the tiles on Payment attempts — same weights, same share line, same bar —
 * so the two queues read as one product rather than two designs.
 */
export function IncidentSummaryCards({
  incidents,
  active = null,
  onPick,
}: {
  incidents: IncidentSummary[];
  active?: SummaryKey | null;
  onPick?: (key: SummaryKey) => void;
}): React.JSX.Element {
  const counts: Record<SummaryKey, number> = {
    all: incidents.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    resolved: 0,
  };
  for (const incident of incidents) {
    if (incident.status === 'resolved') counts.resolved += 1;
    else if (incident.status !== 'expired') counts[bucketOf(incident)] += 1;
  }

  const total = incidents.length;
  const share = (part: number): string =>
    total === 0 ? '0.0% of total' : `${((part / total) * 100).toFixed(1)}% of total`;

  return (
    <section className="incp-metrics" aria-label="Incident severity breakdown">
      {CARDS.map((card) => {
        const count = counts[card.key];
        // The "all" tile is where the queue rests, so it is never drawn as a selection.
        const isActive = active === card.key && card.key !== 'all';
        const isEmpty = count === 0;
        return (
          <button
            key={card.key}
            type="button"
            className={`incp-metric-col${isActive ? ' is-active' : ''}`}
            aria-pressed={isActive}
            title={card.hint}
            onClick={() => onPick?.(card.key)}
          >
            <div className="incp-metric-col__header">
              <span
                className={`incp-metric-dot ${
                  isEmpty && card.key !== 'all'
                    ? 'incp-metric-dot--muted'
                    : `incp-metric-dot--${card.tone}`
                }`}
                aria-hidden="true"
              />
              <span className="incp-metric-label">{card.label}</span>
            </div>
            <div className="incp-metric-values">
              <span className={`incp-metric-num${isEmpty ? ' incp-metric-num--faint' : ''}`}>
                {count}
              </span>
              <span
                className={`incp-metric-share${
                  card.key === 'all'
                    ? ''
                    : isEmpty
                      ? ' incp-metric-share--faint'
                      : ` incp-metric-share--${card.tone}`
                }`}
              >
                {card.key === 'all' ? 'in the queue' : share(count)}
              </span>
            </div>
            <div className="incp-metric-track" aria-hidden="true">
              <div
                className={`incp-metric-fill incp-metric-bar--${card.tone}`}
                style={{
                  width: `${card.key === 'all' ? 100 : total === 0 ? 0 : (count / total) * 100}%`,
                }}
              />
            </div>
          </button>
        );
      })}
    </section>
  );
}
