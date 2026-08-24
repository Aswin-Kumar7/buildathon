import type { ReactNode } from 'react';
import './Badge.css';

export type Tone = 'neutral' | 'critical' | 'warn' | 'ok' | 'info';

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

/** A compact status marker. Tone carries meaning, never decoration. */
export function Badge({ tone = 'neutral', children }: BadgeProps): React.JSX.Element {
  return <span className={`s-badge s-badge--${tone}`}>{children}</span>;
}
