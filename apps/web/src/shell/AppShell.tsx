import { Link, useRouterState } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Badge } from '@sentinel/ui';
import { useLogout, useSession } from '../auth/useSession.js';
import { STOREFRONT_URL } from '../links.js';
import { Icon, type IconName } from './icons.js';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Marks the deepest section that should still light this item up. */
  match?: (pathname: string) => boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      { to: '/console', label: 'Overview', icon: 'overview', match: (p) => p === '/console' },
      {
        to: '/console/incidents',
        label: 'Incidents',
        icon: 'incidents',
        match: (p) => p.startsWith('/console/incidents'),
      },
    ],
  },
  {
    label: 'Analyze',
    items: [{ to: '/console/metrics', label: 'Risk & Model', icon: 'model' }],
  },
  {
    label: 'Govern',
    items: [
      { to: '/console/policy', label: 'Policies', icon: 'policies' },
      { to: '/console/audit', label: 'Audit trail', icon: 'audit' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/console/scenarios', label: 'Simulation', icon: 'simulation' },
      { to: '/console/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const isActive = (item: NavItem, pathname: string): boolean =>
  item.match ? item.match(pathname) : pathname === item.to || pathname.startsWith(`${item.to}/`);

function Sidebar({ onNavigate }: { onNavigate: () => void }): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <aside className="shell__nav" aria-label="Console navigation">
      <div className="shell__brand">
        <span className="shell__mark" aria-hidden="true">
          <Icon name="shield" size={18} />
        </span>
        <span className="shell__brandname">
          Sentinel
          <em>Risk Console</em>
        </span>
      </div>

      <nav className="shell__navscroll">
        {NAV.map((group) => (
          <div className="shell__group" key={group.label}>
            <p className="shell__grouplabel">{group.label}</p>
            <ul>
              {group.items.map((item) => {
                const current = isActive(item, pathname);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className={current ? 'is-current' : undefined}
                      aria-current={current ? 'page' : undefined}
                      onClick={onNavigate}
                    >
                      <Icon name={item.icon} size={17} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shell__navfoot">
        <a className="shell__storefront" href={STOREFRONT_URL} target="_blank" rel="noreferrer">
          <Icon name="store" size={16} />
          Merchant storefront
          <Icon name="external" size={13} className="shell__extico" />
        </a>
      </div>
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }): React.JSX.Element {
  const { user } = useSession();
  const logout = useLogout();
  return (
    <header className="shell__top">
      <button type="button" className="shell__menu" aria-label="Open navigation" onClick={onMenu}>
        <Icon name="menu" size={20} />
      </button>
      <div className="shell__topbrand">
        <span className="shell__mark shell__mark--sm" aria-hidden="true">
          <Icon name="shield" size={15} />
        </span>
        Sentinel
      </div>
      <div className="shell__topright">
        <Badge tone="warn" dot>
          Test mode
        </Badge>
        {user !== null && (
          <div className="shell__user" data-testid="current-user">
            <span className="shell__avatar" aria-hidden="true">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="shell__identity">
              {user.displayName}
              <em>{user.role}</em>
            </span>
          </div>
        )}
        <button
          type="button"
          className="shell__signout"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Sign out"
          title="Sign out"
        >
          <Icon name="logout" size={17} />
        </button>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className={`shell${navOpen ? ' shell--nav-open' : ''}`}>
      {navOpen && (
        <button
          type="button"
          className="shell__scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="shell__main">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main className="shell__content">{children}</main>
      </div>
    </div>
  );
}
