import type { ReactNode } from 'react';
import './Card.css';

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned controls in the header row (a button, a filter, a link). */
  actions?: ReactNode;
  /** `flush` removes body padding for full-bleed content like tables. */
  variant?: 'default' | 'flush';
  /** Lifts on hover — for cards that are themselves a link/button. */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({
  title,
  subtitle,
  actions,
  variant = 'default',
  interactive = false,
  className,
  children,
}: CardProps): React.JSX.Element {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section
      className={['s-card', interactive ? 's-card--interactive' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {hasHeader && (
        <header className="s-card__head">
          <div className="s-card__heading">
            {title !== undefined && <h3 className="s-card__title">{title}</h3>}
            {subtitle !== undefined && <p className="s-card__subtitle">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="s-card__actions">{actions}</div>}
        </header>
      )}
      <div className={variant === 'flush' ? 's-card__body s-card__body--flush' : 's-card__body'}>
        {children}
      </div>
    </section>
  );
}
