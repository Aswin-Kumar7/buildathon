import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDown, CaretUp, Check } from '@phosphor-icons/react';
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
  direction?: 'down' | 'up';
  menuMinWidth?: number | string;
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
  direction = 'down',
  menuMinWidth,
  disabled = false,
}: CustomSelectPillProps<T>): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (val: T) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={[
        'csp-container',
        variant === 'field' ? 'csp-container--field' : 'csp-container--pill',
        direction === 'up' ? 'csp-container--dropup' : '',
        isOpen ? 'is-open' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Hidden standard <select> element for accessibility and testing-library support */}
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Custom Styled Trigger Button */}
      <button
        type="button"
        className={`csp-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        disabled={disabled}
      >
        {icon && <span className="csp-icon">{icon}</span>}
        <span className="csp-label">{selectedOption?.label}</span>
        <span className="csp-chevron">
          {isOpen ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
        </span>
      </button>

      {/* Floating Dropdown Menu Card */}
      {isOpen && (
        <div
          className="csp-dropdown-menu"
          role="listbox"
          style={
            menuMinWidth !== undefined
              ? { minWidth: typeof menuMinWidth === 'number' ? `${menuMinWidth}px` : menuMinWidth }
              : undefined
          }
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`csp-dropdown-item ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleSelect(opt.value)}
                role="option"
                aria-selected={isSelected}
              >
                <span className="csp-item-label">{opt.label}</span>
                {isSelected && <Check size={14} className="csp-check-icon" weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
