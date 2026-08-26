import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import './Field.css';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Render-prop so the control gets the generated id wired to the label. */
  children: (id: string) => ReactNode;
}

/** A labelled form control: label above, hint or error below, the control wired by id between. */
export function Field({ label, hint, error, children }: FieldProps): React.JSX.Element {
  const id = useId();
  return (
    <div className={`s-field${error !== undefined ? ' s-field--error' : ''}`}>
      <label className="s-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error !== undefined ? (
        <p className="s-field__error" role="alert">
          {error}
        </p>
      ) : (
        hint !== undefined && <p className="s-field__hint">{hint}</p>
      )}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={['s-input', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select className={['s-input', 's-select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}
