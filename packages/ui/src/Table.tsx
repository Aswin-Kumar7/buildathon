import type { ReactNode } from 'react';
import './Table.css';

export interface TableProps {
  caption?: string;
  children: ReactNode;
}

/**
 * Wraps a table in its own horizontal scroll container so wide data never makes
 * the page scroll sideways.
 */
export function Table({ caption, children }: TableProps): React.JSX.Element {
  return (
    <div className="s-table-wrap">
      <table className="s-table">
        {caption !== undefined && <caption className="s-table__caption">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
