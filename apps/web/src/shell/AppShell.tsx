import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Badge, Button } from '@sentinel/ui';
import { useLogout, useSession } from '../auth/useSession.js';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  /** Slice that makes this real. Until then it is visibly unavailable, not fake. */
  arrivesIn?: string;
}

const NAV: NavItem[] = [
  { to: '/console', label: 'Overview' },
  { to: '/console/attempts', label: 'Attempts' },
  { to: '/console/features', label: 'Features' },
  { to: '/console/incidents', label: 'Incidents' },
  { to: '/console/compare', label: 'Three that look alike' },
  { to: '/console/scenarios', label: 'Scenarios' },
  { to: '/console/policy', label: 'Policy' },
  { to: '/console/audit', label: 'Audit' },
  { to: '/console/metrics', label: 'Metrics', arrivesIn: 'Slice 12' },
  { to: '/console/health', label: 'System health' },
];

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { user } = useSession();
  const logout = useLogout();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="shell">
      <aside className="shell__nav" aria-label="Console sections">
        <div className="shell__brand">
          <span className="shell__mark" aria-hidden="true" />
          <span>Sentinel</span>
        </div>

        <nav>
          <ul>
            {NAV.map((item) =>
              item.arrivesIn === undefined ? (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={pathname === item.to ? 'is-current' : undefined}
                    aria-current={pathname === item.to ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ) : (
                <li key={item.to}>
                  <span className="shell__pending" aria-disabled="true">
                    {item.label}
                    <em>{item.arrivesIn}</em>
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>
      </aside>

      <div className="shell__main">
        <header className="shell__top">
          {/* Permanent, never dismissible: nobody should ever mistake this for live money. */}
          <Badge tone="warn">test mode</Badge>

          <div className="shell__user">
            {user !== null && (
              <span className="shell__identity" data-testid="current-user">
                {user.displayName} <em>{user.role}</em>
              </span>
            )}
            <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </header>

        <main className="shell__content">{children}</main>
      </div>
    </div>
  );
}
