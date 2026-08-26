import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** An optional leading glyph (an emoji or a small node), kept visually subordinate to the label. */
  icon?: ReactNode;
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  block = false,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={[
        's-button',
        `s-button--${variant}`,
        `s-button--${size}`,
        block ? 's-button--block' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon !== undefined && (
        <span className="s-button__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
