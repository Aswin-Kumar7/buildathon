import type { ReactNode } from 'react';
import './PageHeader.css';

export interface PageHeaderProps {
  /** A small uppercase kicker above the title — the section this page belongs to. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned page-level controls. */
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="s-pagehead">
      <div className="s-pagehead__text">
        {eyebrow !== undefined && <span className="s-pagehead__eyebrow">{eyebrow}</span>}
        <h1 className="s-pagehead__title">{title}</h1>
        {description !== undefined && <p className="s-pagehead__desc">{description}</p>}
      </div>
      {actions !== undefined && <div className="s-pagehead__actions">{actions}</div>}
    </header>
  );
}
