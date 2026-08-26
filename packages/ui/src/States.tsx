import type { ReactNode } from 'react';
import './States.css';

/** A spinner, sized to the current font unless a size is given. */
export function Spinner({ size = '1.25rem' }: { size?: string }): React.JSX.Element {
  return <span className="s-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** A centred loading state with a spinner and a status line, announced politely. */
export function Loading({ label = 'Loading…' }: { label?: string }): React.JSX.Element {
  return (
    <div className="s-state" role="status">
      <Spinner size="1.75rem" />
      <p className="s-state__text">{label}</p>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/** Nothing to show — said calmly, with a way forward rather than a dead end. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="s-state">
      {icon !== undefined && (
        <span className="s-state__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="s-state__title">{title}</p>
      {description !== undefined && <p className="s-state__text">{description}</p>}
      {action !== undefined && <div className="s-state__action">{action}</div>}
    </div>
  );
}

/** Something went wrong — stated plainly, never swallowed. The message is announced as an alert. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  action,
}: {
  title?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="s-state s-state--error">
      <span className="s-state__icon" aria-hidden="true">
        ⚠
      </span>
      <p className="s-state__title">{title}</p>
      <p className="s-state__text" role="alert">
        {message}
      </p>
      {action !== undefined && <div className="s-state__action">{action}</div>}
    </div>
  );
}
