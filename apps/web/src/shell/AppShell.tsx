import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { systemHealthResponseSchema, type SystemHealthResponse } from '@sentinel/contracts';
import { Link, useRouterState } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useLogout, useSession } from '../auth/useSession.js';
import { NotificationBell } from './NotificationBell.js';
import {
  SquaresFour,
  CreditCard,
  WarningCircle,
  ClipboardText,
  ListChecks,
  Gear,
  SignOut,
  ArrowsClockwise,
  List,
} from '@phosphor-icons/react';
import { EnforcementBanner } from './EnforcementBanner.js';
import { SimDockProvider } from './SimulationDock.js';
import razorpayLogo from '../assets/razorpay-logo.svg';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: typeof SquaresFour;
  match?: (pathname: string) => boolean;
  type?: 'attempts' | 'incidents';
}

const NAV_MONITOR: NavItem[] = [
  {
    to: '/console',
    label: 'Overview',
    icon: SquaresFour,
    match: (p) => p === '/console' || p === '/console/',
  },
  {
    to: '/console/attempts',
    label: 'Attempts',
    icon: CreditCard,
    match: (p) => p === '/console/attempts' || p.startsWith('/console/attempts/'),
    type: 'attempts',
  },
  {
    to: '/console/incidents',
    label: 'Incidents',
    icon: WarningCircle,
    match: (p) => p === '/console/incidents' || p.startsWith('/console/incidents/'),
    type: 'incidents',
  },
  {
    to: '/console/policy',
    label: 'Policy',
    icon: ClipboardText,
    match: (p) => p === '/console/policy' || p.startsWith('/console/policy/'),
  },
  {
    to: '/console/audit',
    label: 'Audit trail',
    icon: ListChecks,
    match: (p) => p === '/console/audit' || p.startsWith('/console/audit/'),
  },
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
  if (!name) return 'AK';
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
  const logout = useLogout();
  const initials = getInitials(user?.displayName);

  // Dynamic live badge count queries
  const attemptsQuery = useQuery({
    queryKey: ['attempt-count-sidebar'],
    queryFn: async () => {
      const res = await fetch('/api/attempts/rows?page=1&pageSize=1', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const incidentsQuery = useQuery({
    queryKey: ['incidents-count-sidebar'],
    queryFn: async () => {
      const res = await fetch('/api/incidents', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });

  const attemptsCount: number | undefined = attemptsQuery.data?.total;
  const activeIncidentsCount: number = incidentsQuery.data?.counts
    ? (incidentsQuery.data.counts.open ?? 0) + (incidentsQuery.data.counts.underReview ?? 0)
    : (incidentsQuery.data?.incidents?.filter(
        (i: { status: string }) => i.status === 'open' || i.status === 'under_review',
      ).length ?? 0);

  return (
    <aside className="shell__nav" aria-label="Console navigation">
      {/* Brand Top Header */}
      <div className="shell__brand-top">
        <img src={razorpayLogo} alt="Razorpay" className="shell__razorpay-logo" />
        <span className="shell__brand-divider" aria-hidden="true" />
        <span className="shell__buildathon-text">buildathon</span>
      </div>

      <div className="shell__product-block">
        <div className="shell__product-title">Sentinel</div>
        <div className="shell__product-subtitle">Fraud &amp; Abuse Protection</div>
      </div>

      {/* Navigation list */}
      <nav className="shell__nav-list">
        <div className="shell__nav-divider" aria-hidden="true" />
        <div className="shell__nav-section-title">Monitor</div>

        {NAV_MONITOR.map((item) => {
          const current = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`shell__nav-item${current ? ' is-active' : ''}`}
              aria-current={current ? 'page' : undefined}
              onClick={onNavigate}
            >
              <Icon size={17} className="shell__nav-icon" />
              <span className="shell__nav-label">{item.label}</span>

              {item.type === 'attempts' && attemptsCount !== undefined && attemptsCount > 0 && (
                <span className="shell__nav-badge-count">{attemptsCount}</span>
              )}
            </Link>
          );
        })}

        <div className="shell__nav-divider" aria-hidden="true" style={{ margin: '14px 12px' }} />

        <Link
          to="/console/settings"
          className={`shell__nav-item${pathname.startsWith('/console/settings') ? ' is-active' : ''}`}
          aria-current={pathname.startsWith('/console/settings') ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Gear size={17} className="shell__nav-icon" />
          <span className="shell__nav-label">Settings</span>
        </Link>
      </nav>

      {/* User Account Footer */}
      <div className="shell__user-foot" data-testid="current-user">
        <span className="shell__user-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="shell__user-details">
          <div className="shell__user-name">{user?.displayName ?? 'Aswin Kumar'}</div>
          <div className="shell__user-account">Merchant Account</div>
        </div>
        <button
          type="button"
          className="shell__logout-btn"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Sign out"
          title="Log out"
        >
          <SignOut size={16} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }): React.JSX.Element {
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
        <List size={20} />
      </button>

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
          <ArrowsClockwise size={16} />
        </button>
        <NotificationBell />
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
