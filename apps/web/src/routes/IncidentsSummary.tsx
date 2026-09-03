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

export type SummaryKey = Bucket | 'resolved';

const CARDS: {
  key: SummaryKey;
  label: string;
  dotClass: string;
  barClass: string;
}[] = [
  {
    key: 'critical',
    label: 'Critical',
    dotClass: 'incp-metric-dot--critical',
    barClass: 'incp-metric-bar--critical',
  },
  {
    key: 'high',
    label: 'High',
    dotClass: 'incp-metric-dot--high',
    barClass: 'incp-metric-bar--high',
  },
  {
    key: 'medium',
    label: 'Medium',
    dotClass: 'incp-metric-dot--medium',
    barClass: 'incp-metric-bar--medium',
  },
  {
    key: 'low',
    label: 'Low',
    dotClass: 'incp-metric-dot--low',
    barClass: 'incp-metric-bar--low',
  },
  {
    key: 'resolved',
    label: 'Resolved',
    dotClass: 'incp-metric-dot--resolved',
    barClass: 'incp-metric-bar--resolved',
  },
];

/**
 * The tier cards double as the fastest triage filter: each one is a button that narrows the table to
 * its own tier (or clears itself when it is already the active filter), so a merchant scanning the
 * queue can jump straight to what needs attention. Counts are real — non-resolved, non-expired
 * incidents per bucket, and closed incidents under Resolved.
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
  const counts = { critical: 0, high: 0, medium: 0, low: 0, resolved: 0 };
  for (const incident of incidents) {
    if (incident.status === 'resolved') counts.resolved += 1;
    else if (incident.status !== 'expired') counts[bucketOf(incident)] += 1;
  }

  const total = incidents.length || 1;

  return (
    <section className="incp-metrics" aria-label="Incident severity breakdown">
      {CARDS.map((card) => {
        const count = counts[card.key];
        const isActive = active === card.key;
        const fillPct = (count / total) * 100;
        return (
          <button
            key={card.key}
            type="button"
            className={`incp-metric-col${isActive ? ' is-active' : ''}`}
            aria-pressed={isActive}
            onClick={() => onPick?.(card.key)}
          >
            <div className="incp-metric-col__header">
              <span className={`incp-metric-dot ${card.dotClass}`} aria-hidden="true" />
              <span className="incp-metric-label">{card.label}</span>
            </div>
            <span className={`incp-metric-num ${count === 0 ? 'incp-metric-num--faint' : ''}`}>
              {count}
            </span>
            <div className="incp-metric-track" aria-hidden="true">
              {count > 0 && (
                <div
                  className={`incp-metric-fill ${card.barClass}`}
                  style={{ width: `${fillPct}%` }}
                />
              )}
            </div>
          </button>
        );
      })}
    </section>
  );
}
