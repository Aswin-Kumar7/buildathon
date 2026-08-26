import type { ReactNode } from 'react';
import type { Tone } from './Badge.js';
import './StatCard.css';

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** A small qualifier under the value — a delta, a unit, a share. */
  hint?: ReactNode;
  tone?: Tone;
  /** An emoji or small glyph, shown in a soft tinted chip. */
  icon?: ReactNode;
}

/**
 * A single headline number. The label sits above the value (never the reverse), the tone tints only
 * the icon chip and the accent rule, and everything else stays neutral — so a wall of stat cards
 * reads as data, not a set of competing alarms.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: StatCardProps): React.JSX.Element {
  return (
    <div className={`s-stat s-stat--${tone}`}>
      {icon !== undefined && (
        <span className="s-stat__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="s-stat__body">
        <span className="s-stat__label">{label}</span>
        <span className="s-stat__value">{value}</span>
        {hint !== undefined && <span className="s-stat__hint">{hint}</span>}
      </div>
    </div>
  );
}
