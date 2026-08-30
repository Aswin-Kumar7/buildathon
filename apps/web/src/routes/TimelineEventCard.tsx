import type { TimelineEvent } from './IncidentTimelineTab.js';

/* Small, restrained inline icons — a console, not an emoji board. */
const box = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true,
} as const;
export const ICON: Record<TimelineEvent['icon'], () => React.JSX.Element> = {
  flag: () => (
    <svg {...box}>
      <path
        d="M6 21V4M6 4h11l-2 3 2 3H6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  card: () => (
    <svg {...box}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  sparkle: () => (
    <svg {...box}>
      <path
        d="M12 3l1.8 4.4L18.2 9.2 13.8 11 12 15.4 10.2 11 5.8 9.2 10.2 7.4z"
        fill="currentColor"
      />
    </svg>
  ),
  check: () => (
    <svg {...box}>
      <path
        d="M5 12l5 5 9-11"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  cross: () => (
    <svg {...box}>
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  shield: () => (
    <svg {...box}>
      <path
        d="M12 3l7 3v5c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  ),
  workflow: () => (
    <svg {...box}>
      <path
        d="M4 7h9m0 0l-3-3m3 3l-3 3M20 17h-9m0 0l3-3m-3 3l3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  gear: () => (
    <svg {...box}>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.5-6.5l-2 2m-9 9l-2 2m13 0l-2-2m-9-9l-2-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
};

const Chevron = ({ open }: { open: boolean }): React.JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    style={{ transform: open ? 'rotate(180deg)' : undefined }}
  >
    <path
      d="M6 9l6 6 6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function TimelineEventCard({
  event,
  expanded,
  onToggle,
  last,
}: {
  event: TimelineEvent;
  expanded: boolean;
  onToggle: () => void;
  last: boolean;
}): React.JSX.Element {
  const Icon = ICON[event.icon];
  return (
    <li className="tl-row">
      <div className="tl-when">
        <span className="tl-when__date">{event.date}</span>
        <span className="tl-when__time">{event.time}</span>
        <span className="tl-when__ago">{event.ago}</span>
      </div>
      <div className={`tl-rail${last ? ' tl-rail--last' : ''}`}>
        <span className={`tl-node tl-node--${event.node}`}>
          <Icon />
        </span>
      </div>
      <div className="tl-card">
        <div className="tl-card__head">
          <strong className="tl-card__title">{event.title}</strong>
          {event.badge !== null && (
            <span className={`tl-badge tl-badge--${event.badge.tone}`}>{event.badge.label}</span>
          )}
          {event.details.length > 0 && (
            <button
              type="button"
              className="tl-details"
              onClick={onToggle}
              aria-expanded={expanded}
            >
              View details <Chevron open={expanded} />
            </button>
          )}
        </div>
        <p className="tl-card__desc">{event.description}</p>
        <p className="tl-card__meta">
          {event.actor !== null && (
            <>
              By <span className="tl-actor">{event.actor}</span>
              <span className="tl-dot" aria-hidden="true">
                ·
              </span>
            </>
          )}
          Via {event.source}
        </p>
        {expanded && event.details.length > 0 && (
          <dl className="tl-fields">
            {event.details.map(([label, value]) => (
              <div key={label} className="tl-field">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}
