import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  incidentListResponseSchema,
  notificationPrefsSchema,
  type IncidentSummary,
  type NotificationPrefs,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { Icon } from './icons.js';
import './NotificationBell.css';

export const NOTIFY_PREFS_KEY = ['notification-prefs'] as const;
const NOTIFY_INCIDENTS_KEY = ['notification-incidents'] as const;
const RANK: Record<NotificationPrefs['minSeverity'], number> = { low: 0, medium: 1, high: 2 };

async function fetchIncidents(): Promise<IncidentSummary[]> {
  const response = await fetch('/api/incidents', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentListResponseSchema.parse(await response.json()).incidents;
}
async function fetchPrefs(): Promise<NotificationPrefs> {
  const response = await fetch('/api/notifications/prefs', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return notificationPrefsSchema.parse(await response.json());
}
async function markSeen(): Promise<void> {
  const response = await fetch('/api/notifications/seen', {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(),
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
}

/** Real incidents, narrowed to the ones this user's preferences say should raise the bell. */
function notifiable(
  incidents: IncidentSummary[],
  prefs: NotificationPrefs | undefined,
): IncidentSummary[] {
  if (prefs === undefined) return [];
  const min = RANK[prefs.minSeverity];
  return incidents
    .filter((incident) => RANK[incident.severity] >= min)
    .filter((incident) => prefs.simulated || incident.source !== 'replay')
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function NotificationBell(): React.JSX.Element {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  const incidents = useQuery({
    queryKey: NOTIFY_INCIDENTS_KEY,
    queryFn: fetchIncidents,
    refetchInterval: 15_000,
  });
  const prefs = useQuery({ queryKey: NOTIFY_PREFS_KEY, queryFn: fetchPrefs });

  const list = useMemo(
    () => notifiable(incidents.data ?? [], prefs.data),
    [incidents.data, prefs.data],
  );
  const seenAt = prefs.data?.seenAt ?? null;
  const seenMs = seenAt === null ? 0 : Date.parse(seenAt);
  const unread = list.filter((incident) => incident.detectedAt > seenMs).length;

  const seen = useMutation({
    mutationFn: markSeen,
    onSuccess: () => void client.invalidateQueries({ queryKey: NOTIFY_PREFS_KEY }),
  });

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (unread > 0 && !seen.isPending) seen.mutate();
  };

  return (
    <div className="notif">
      <button
        type="button"
        className="notif__bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="notif__badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="notif__scrim"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="notif__panel" role="dialog" aria-label="Notifications">
            <header className="notif__head">
              <h2>Notifications</h2>
              <button
                type="button"
                className="notif__close"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>
            <NotifBody
              list={list}
              loading={incidents.isPending || prefs.isPending}
              error={incidents.isError ? incidents.error.message : null}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function NotifBody({
  list,
  loading,
  error,
  onNavigate,
}: {
  list: IncidentSummary[];
  loading: boolean;
  error: string | null;
  onNavigate: () => void;
}): React.JSX.Element {
  if (error !== null)
    return (
      <p className="notif__empty" role="alert">
        Couldn&rsquo;t load notifications. {error}
      </p>
    );
  if (loading)
    return (
      <p className="notif__empty" role="status">
        Loading…
      </p>
    );
  if (list.length === 0)
    return (
      <p className="notif__empty">
        You&rsquo;re all caught up. Incidents appear here as soon as they&rsquo;re detected.
      </p>
    );
  return (
    <ul className="notif__list">
      {list.slice(0, 12).map((incident) => (
        <li key={incident.id}>
          <Link
            to="/console/incidents/$id"
            params={{ id: incident.id }}
            className="notif__item"
            onClick={onNavigate}
          >
            <span className={`notif__dot notif__dot--${incident.severity}`} aria-hidden="true" />
            <span className="notif__text">
              <span className="notif__title">{incident.title}</span>
              <span className="notif__meta">
                <span className={`notif__src notif__src--${incident.source}`}>
                  {incident.source === 'replay' ? 'Simulation' : 'Live'}
                </span>
                <span>{ago(incident.detectedAt)}</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
