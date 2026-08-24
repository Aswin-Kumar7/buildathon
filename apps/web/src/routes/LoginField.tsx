interface LoginFieldProps {
  id: 'email' | 'password';
  label: string;
  type: 'email' | 'password';
  autoComplete: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

/** A labelled input that wires its own error to `aria-describedby`. */
export function LoginField({
  id,
  label,
  type,
  autoComplete,
  value,
  error,
  onChange,
}: LoginFieldProps): React.JSX.Element {
  const errorId = `${id}-error`;
  const hasError = error !== undefined;

  return (
    <div className="login__field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
      />
      {hasError && (
        <p className="login__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
