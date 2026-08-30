import type { IncidentSummary } from '@sentinel/contracts';
import { WarningCircle, Check } from '@phosphor-icons/react';

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

const CARDS: { key: Bucket | 'resolved'; label: string; tone: string; icon: React.ElementType }[] =
  [
    { key: 'critical', label: 'Critical', tone: 'critical', icon: WarningCircle },
    { key: 'high', label: 'High', tone: 'high', icon: WarningCircle },
    { key: 'medium', label: 'Medium', tone: 'medium', icon: WarningCircle },
    { key: 'low', label: 'Low', tone: 'low', icon: WarningCircle },
    { key: 'resolved', label: 'Resolved', tone: 'resolved', icon: Check },
  ];

export type SummaryKey = Bucket | 'resolved';

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

  return (
    <div className="incp-cards">
      {CARDS.map((card) => {
        const Icon = card.icon;
        const isActive = active === card.key;
        return (
          <button
            key={card.key}
            type="button"
            className={`incp-card incp-card--${card.tone}${isActive ? ' is-active' : ''}`}
            aria-pressed={isActive}
            onClick={() => onPick?.(card.key)}
          >
            <div className="incp-card__inner">
              <span className={`incp-card__icon incp-card__icon--${card.tone}`}>
                <Icon />
              </span>
              <div className="incp-card__body">
                <span className="incp-card__label">{card.label}</span>
                <strong className="incp-card__count">{counts[card.key]}</strong>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
