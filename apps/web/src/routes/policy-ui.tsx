import { useEffect, type ReactNode } from 'react';

/** An accessible on/off switch — the one control the shared library does not yet provide. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`pol-toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="pol-toggle__knob" aria-hidden="true" />
    </button>
  );
}

/** A centered modal dialog: dimmed backdrop, Escape to close, click-away to close. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pol-modal__overlay" onClick={onClose}>
      <div
        className={`pol-modal${wide ? ' pol-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pol-modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle !== undefined && <p>{subtitle}</p>}
          </div>
          <button type="button" className="pol-modal__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="pol-modal__body">{children}</div>
      </div>
    </div>
  );
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};

/** A backend timestamp (epoch ms) rendered for a merchant, or an em dash when the backend has none. */
export const fmtDateTime = (ms: number | null): string =>
  ms === null ? '—' : new Date(ms).toLocaleString('en-IN', DATE_TIME);
