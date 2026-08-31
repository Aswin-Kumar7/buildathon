import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IncidentDetail } from '@sentinel/contracts';
import { IncidentDetailPage } from './IncidentDetailPage.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
  useParams: () => ({ id: 'a1' }),
}));

function detail(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: 'a1',
    key: 'session:v1:abcdef:1',
    entityKind: 'session',
    entityKey: 'v1:abcdef0123456789',
    status: 'open',
    severity: 'high',
    score: 0.6,
    scoreLower: 0.6,
    scoreUpper: 0.6,
    band: 'high',
    firstAttemptAt: T0,
    detectedAt: T0 + 300_000,
    lastActivityAt: T0 + 290_000,
    expiresAt: T0 + 2_090_000,
    timeToDetectMs: 300_000,
    observations: 3,
    source: 'razorpay',
    firedRules: ['card_spread'],
    recommendedDecision: 'review',
    primaryHypothesis: 'attack',
    attempts: 3,
    failures: 3,
    distinctCards: 40,
    title: 'Coordinated card testing',
    evidence: [
      {
        rule: 'card_spread',
        code: 'distinct_cards_above_threshold',
        observed: 40,
        threshold: 8,
        weight: 0.35,
      },
      {
        rule: 'approval_collapse',
        code: 'approval_rate_below_floor',
        observed: 0.03,
        threshold: 0.2,
        weight: 0.25,
      },
      {
        rule: 'recovery',
        code: 'orders_recovered_after_failure',
        observed: 2,
        threshold: 0,
        weight: -0.4,
      },
    ],
    abstentions: [{ rule: 'machine_cadence', reason: 'insufficient-data' }],
    change: null,
    arbitration: null,
    modelOpinion: null,
    modelAvailable: false,
    label: null,
    labelSource: null,
    thresholdHash: 'a1b2c3d4',
    history: [],
    relatedOrders: [],
    graph: { entity: { kind: 'session', fingerprint: 'abcd1234' }, cards: [], sessions: [] },
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(incident: IncidentDetail): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ incident }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

/** The detail page is tabbed; deeper panels live behind their tab. Waits for load, then switches. */
async function openTab(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name }));
}

describe('IncidentDetailPage', () => {
  it('shows mitigating evidence beside the incriminating, not in a separate panel', async () => {
    // A reader deciding whether to act on somebody needs to see what argued against it in the
    // same glance, not one scroll away. The overview's evidence list carries both.
    stub(detail());
    render(wrap(<IncidentDetailPage />));

    // The mitigating signal (a recovery) is unique to the evidence list.
    expect(await screen.findByText(/2 orders failed and were then paid/)).toBeInTheDocument();
    // The strongest incriminating signal appears both as the headline reason and in the list.
    expect(screen.getAllByText(/40 different cards/).length).toBeGreaterThan(0);
  });

  it('offers the resolution verdicts on an actionable incident', async () => {
    stub(detail({ status: 'contained' }));
    render(wrap(<IncidentDetailPage />));
    await openTab('Actions & audit');

    // The Actions & audit tab is the AI recommendation + action history + audit log; the incident's
    // own verdict (the retraining label) is the resolve footer on the history card.
    expect(await screen.findByRole('button', { name: /Confirmed abuse/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /False positive/ })).toBeInTheDocument();
  });

  it('offers no resolution verdicts on a terminal incident', async () => {
    stub(detail({ status: 'resolved' }));
    render(wrap(<IncidentDetailPage />));
    await openTab('Actions & audit');

    expect(await screen.findByText('Action history')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Confirmed abuse|False positive/ }),
    ).not.toBeInTheDocument();
  });

  it('sends the resolution verdict the analyst picked', async () => {
    const fetchMock = stub(detail());
    render(wrap(<IncidentDetailPage />));
    await openTab('Actions & audit');

    await userEvent.click(await screen.findByRole('button', { name: /Confirmed abuse/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents/a1/transition',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: 'resolved', verdict: 'confirmed_abuse' }),
      }),
    );
  });

  it('labels a resolution as a false positive for retraining', async () => {
    const fetchMock = stub(detail());
    render(wrap(<IncidentDetailPage />));
    await openTab('Actions & audit');

    await userEvent.click(await screen.findByRole('button', { name: /False positive/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents/a1/transition',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: 'resolved', verdict: 'false_positive' }),
      }),
    );
  });

  it('shows the status and severity in the header for an under-review incident', async () => {
    stub(detail({ status: 'under_review' }));
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText('Under review')).toBeInTheDocument();
    expect(screen.getByText(/high severity/)).toBeInTheDocument();
  });

  it('disables the action button on a terminal (expired) incident', async () => {
    stub(detail({ status: 'expired' }));
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText('Expired')).toBeInTheDocument();
  });

  it('surfaces a failure rather than a blank page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 404');
  });
});
