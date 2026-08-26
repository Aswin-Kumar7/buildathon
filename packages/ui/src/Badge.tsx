import type { ReactNode } from 'react';
import './Badge.css';

export type Tone = 'neutral' | 'critical' | 'warn' | 'ok' | 'info' | 'accent';

export interface BadgeProps {
  tone?: Tone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** A leading status dot, for live/status badges. */
  dot?: boolean;
  children: ReactNode;
}

/** A compact status marker. Tone carries meaning, never decoration. */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  dot = false,
  children,
}: BadgeProps): React.JSX.Element {
  return (
    <span className={`s-badge s-badge--${tone} s-badge--${variant} s-badge--${size}`}>
      {dot && <span className="s-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
