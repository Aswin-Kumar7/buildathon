import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IncidentSummary, NotificationPrefs } from '@sentinel/contracts';
import { NotificationBell } from './NotificationBell.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

function incident(over: Partial<IncidentSummary>): IncidentSummary {
  return {
    id: 'i1',
    key: 'k1',
    entityKind: 'session',
    entityKey: 'sess-1',
    status: 'open',
    severity: 'high',
    score: 0.8,
    scoreLower: 0.7,
    scoreUpper: 0.9,
    band: 'high',
    firstAttemptAt: 1000,
    detectedAt: 2000,
    lastActivityAt: 2000,
    expiresAt: 9000,
    timeToDetectMs: 1000,
    observations: 1,
    source: 'razorpay',
    firedRules: ['card_spread'],
    recommendedDecision: 'review',
    primaryHypothesis: 'attack',
    attempts: 10,
    failures: 9,
    distinctCards: 8,
    title: 'Untitled',
    ...over,
  };
}

const HIGH = incident({
  id: 'hi',
  title: 'Card testing burst',
  severity: 'high',
  detectedAt: 5000,
});
const LOW = incident({ id: 'lo', title: 'Minor anomaly', severity: 'low', detectedAt: 4000 });

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(prefs: NotificationPrefs, incidents: IncidentSummary[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const body = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes('/api/notifications/seen'))
      return body({ ...prefs, seenAt: new Date().toISOString() });
    if (url.includes('/api/notifications/prefs')) return body(prefs);
    if (url.includes('/api/incidents'))
      return body({
        incidents,
        counts: { open: incidents.length, underReview: 0, contained: 0, resolved: 0, expired: 0 },
        thresholdHash: 'h',
      });
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('NotificationBell', () => {
  it('badges every unseen incident and lists them on open', async () => {
    const fetchMock = stub({ minSeverity: 'low', simulated: true, seenAt: null }, [HIGH, LOW]);
    render(wrap(<NotificationBell />));

    // Two real incidents, never marked read → both unread.
    const bell = await screen.findByRole('button', { name: /2 unread/ });
    await userEvent.click(bell);

    expect(screen.getByText('Card testing burst')).toBeInTheDocument();
    expect(screen.getByText('Minor anomaly')).toBeInTheDocument();
    // Opening marks them read against the server clock, not a client-sent value.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/seen',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('honours the minimum-severity preference', async () => {
    stub({ minSeverity: 'high', simulated: true, seenAt: null }, [HIGH, LOW]);
    render(wrap(<NotificationBell />));

    // Only the high-severity incident clears the 'high only' bar.
    const bell = await screen.findByRole('button', { name: /1 unread/ });
    await userEvent.click(bell);

    expect(screen.getByText('Card testing burst')).toBeInTheDocument();
    expect(screen.queryByText('Minor anomaly')).not.toBeInTheDocument();
  });
});
