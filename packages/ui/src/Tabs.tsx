import type { ReactNode } from 'react';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: ReactNode;
}

/** A horizontal tab bar for switching views within a page. Controlled — the page owns the state. */
export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={['s-tabs', className].filter(Boolean).join(' ')} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === active}
          className={`s-tabs__tab${item.id === active ? ' is-active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
