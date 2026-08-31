import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { systemHealthResponseSchema, type SystemHealthResponse } from '@sentinel/contracts';
import { Link, useRouterState } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useLogout, useSession } from '../auth/useSession.js';
import { Icon, type IconName } from './icons.js';
import { NotificationBell } from './NotificationBell.js';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { EnforcementBanner } from './EnforcementBanner.js';
import { SimDockProvider } from './SimulationDock.js';
import razorpayLogo from '../assets/white.png';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  match?: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { to: '/console', label: 'Overview', icon: 'overview', match: (p) => p === '/console' },
  { to: '/console/attempts', label: 'Attempts', icon: 'attempts' },
  { to: '/console/incidents', label: 'Incidents', icon: 'incidents' },
  { to: '/console/policy', label: 'Policies', icon: 'policies' },
  { to: '/console/audit', label: 'Audit', icon: 'audit' },
];

const isActive = (item: NavItem, pathname: string): boolean =>
  item.match ? item.match(pathname) : pathname === item.to || pathname.startsWith(`${item.to}/`);

async function getSystemHealth(): Promise<SystemHealthResponse> {
  const response = await fetch('/api/system/health', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return systemHealthResponseSchema.parse(await response.json());
}

function healthPill(system: UseQueryResult<SystemHealthResponse>): { label: string; ok: boolean } {
  if (system.isPending) return { label: 'Checking system…', ok: true };
  if (system.isError || system.data === undefined) {
    return { label: 'System status unavailable', ok: false };
  }
  const shedding = system.data.health.shedding;
  return shedding.length === 0
    ? { label: 'System healthy', ok: true }
    : {
        label: `Degraded — shedding ${shedding.length} tier${shedding.length === 1 ? '' : 's'}`,
        ok: false,
      };
}

function getInitials(name?: string): string {
  if (!name) return 'DA';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const p0 = parts[0];
  const p1 = parts[1];
  if (p0 && p1) {
    return (p0.slice(0, 1) + p1.slice(0, 1)).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function Sidebar({ onNavigate }: { onNavigate: () => void }): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user } = useSession();
  const initials = getInitials(user?.displayName);

  return (
    <aside className="shell__nav" aria-label="Console navigation">
      <div className="shell__brand">
        <div className="shell__company-info">
          <img src={razorpayLogo} alt="Razorpay" className="shell__razorpay-img" />
          <span className="shell__buildathon-tag">/ buildathon</span>
        </div>

        <div className="shell__product-name">
          <h2>Sentinel</h2>
          <p>Fraud &amp; Abuse Protection</p>
        </div>
      </div>

      <div className="shell__inset-divider" />

      <nav className="shell__navscroll">
        <ul>
          {NAV.map((item) => {
            const current = isActive(item, pathname);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={current ? 'is-current' : undefined}
                  aria-current={current ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="shell__settings-link">
          <Link
            to="/console/settings"
            className={
              isActive({ to: '/console/settings', label: 'Settings', icon: 'settings' }, pathname)
                ? 'is-current'
                : undefined
            }
            onClick={onNavigate}
          >
            <Icon name="settings" size={18} />
            <span>Settings</span>
          </Link>
        </div>
      </nav>

      <div className="shell__inset-divider" />

      <div className="shell__navfoot">
        <div className="shell__account" data-testid="current-user">
          <span className="shell__acct-avatar" aria-hidden="true">
            {initials}
          </span>
          <div className="shell__acct-id">
            <strong>{user?.displayName ?? 'Demo Analyst'}</strong>
            <span>Merchant Account</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }): React.JSX.Element {
  const logout = useLogout();
  const queryClient = useQueryClient();
  const system = useQuery({
    queryKey: ['system-health', 'header'],
    queryFn: getSystemHealth,
    refetchInterval: 15_000,
  });

  const health = healthPill(system);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <header className="shell__top">
      <button type="button" className="shell__menu" aria-label="Open navigation" onClick={onMenu}>
        <Icon name="menu" size={20} />
      </button>
      <div className="shell__topbrand">
        <span className="shell__mark shell__mark--sm" aria-hidden="true">
          <Icon name="shield" size={18} />
        </span>
        Sentinel
      </div>
      <div className="shell__topright">
        <span className={`shell__health-pill${health.ok ? '' : ' shell__health-pill--bad'}`}>
          <span className="shell__health-dot" />
          {health.label}
        </span>
        <button
          type="button"
          className={`shell__header-refresh-icon-btn${isRefreshing ? ' is-refreshing' : ''}`}
          onClick={handleRefresh}
          aria-label="Refresh data"
          title="Refresh data"
        >
          <ArrowsClockwise />
        </button>
        <NotificationBell />
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
    <SimDockProvider>
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
          <main className="shell__content">
            <EnforcementBanner />
            {children}
          </main>
        </div>
      </div>
    </SimDockProvider>
  );
}
