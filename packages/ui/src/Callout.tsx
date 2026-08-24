import type { ReactNode } from 'react';
import type { Tone } from './Badge.js';
import './Callout.css';

export interface CalloutProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}

export function Callout({ tone = 'info', title, children }: CalloutProps): React.JSX.Element {
  return (
    <div className={`s-callout s-callout--${tone}`}>
      {title !== undefined && <p className="s-callout__title">{title}</p>}
      {children}
    </div>
  );
}
