import type { ReactNode } from 'react';
import type { Tone } from './Badge.js';
import './StatusDot.css';

/** A tone-coloured dot beside a label — for statuses in dense rows where a full badge is too heavy. */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className={`s-statusdot s-statusdot--${tone}`}>
      <span className={`s-statusdot__dot${pulse ? ' is-pulse' : ''}`} aria-hidden="true" />
      {children}
    </span>
  );
}
