import type { ReactNode } from 'react';
import './Card.css';

export interface CardProps {
  title?: string;
  children: ReactNode;
}

export function Card({ title, children }: CardProps): React.JSX.Element {
  return (
    <section className="s-card">
      {title !== undefined && <h3 className="s-card__title">{title}</h3>}
      <div className="s-card__body">{children}</div>
    </section>
  );
}
