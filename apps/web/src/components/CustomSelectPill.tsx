import type { ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import './CustomSelectPill.css';

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface CustomSelectPillProps<T extends string = string> {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  icon?: ReactNode;
  className?: string;
  variant?: 'pill' | 'field';
  disabled?: boolean;
}

export function CustomSelectPill<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
  className,
  variant = 'pill',
  disabled = false,
}: CustomSelectPillProps<T>): React.JSX.Element {
  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div
      className={[
        'csp-container',
        variant === 'field' ? 'csp-container--field' : 'csp-container--pill',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Overlay native select */}
      <select
        className="csp-native-select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Styled Custom Pill Trigger */}
      <div className="csp-trigger" aria-hidden="true">
        {icon && <span className="csp-icon">{icon}</span>}
        <span className="csp-label">{selectedOption?.label}</span>
        <span className="csp-chevron">
          <CaretDown />
        </span>
      </div>
    </div>
  );
}
