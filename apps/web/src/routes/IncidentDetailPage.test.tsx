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
    thresholdHash: 'a1b2c3d4',
    history: [],
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

describe('IncidentDetailPage', () => {
  it('shows the score as the sum it actually is, signs included', async () => {
    stub(detail());
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText('+0.35')).toBeInTheDocument();
    expect(screen.getByText('+0.25')).toBeInTheDocument();
    expect(screen.getByText('-0.40')).toBeInTheDocument();
    expect(screen.getByText('0.20')).toBeInTheDocument();
  });

  it('shows mitigating evidence beside the incriminating, not in a separate panel', async () => {
    // A reader deciding whether to act on somebody needs to see what argued against it in the
    // same glance, not one scroll away.
    stub(detail());
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText(/2 orders failed and were then paid/)).toBeInTheDocument();
    expect(screen.getByText(/40 different cards/)).toBeInTheDocument();
  });

  it('separates what could not be judged from what found nothing', async () => {
    stub(detail());
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText(/What could not be judged/)).toBeInTheDocument();
    expect(screen.getByText(/not enough activity to judge this yet/)).toBeInTheDocument();
  });

  it('offers only the moves the state machine allows', async () => {
    stub(detail({ status: 'contained' }));
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByRole('button', { name: /Mark resolved/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark under review/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark contained/ })).not.toBeInTheDocument();
  });

  it('offers nothing on a terminal incident, and says why', async () => {
    stub(detail({ status: 'resolved' }));
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText(/Resolved is final/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Mark/ })).not.toBeInTheDocument();
  });

  it('sends the transition the analyst picked', async () => {
    const fetchMock = stub(detail());
    render(wrap(<IncidentDetailPage />));
    await screen.findByText('+0.35');

    await userEvent.click(screen.getByRole('button', { name: /Mark under review/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents/a1/transition',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ to: 'under_review' }) }),
    );
  });

  it('shows who moved it and when', async () => {
    stub(
      detail({
        status: 'under_review',
        history: [
          { from: 'open', to: 'under_review', actor: 'Ana', note: 'checking', at: T0 + 400_000 },
        ],
      }),
    );
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText(/Open → Under review/)).toBeInTheDocument();
    expect(screen.getByText(/by Ana/)).toBeInTheDocument();
    expect(screen.getByText(/checking/)).toBeInTheDocument();
  });

  it('names the system rather than a person for an automatic move', async () => {
    stub(
      detail({
        status: 'expired',
        history: [
          { from: 'open', to: 'expired', actor: null, note: 'no activity', at: T0 + 900_000 },
        ],
      }),
    );
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText(/by the system/)).toBeInTheDocument();
  });

  it('explains a change-detection alarm in its own terms', async () => {
    stub(
      detail({
        change: {
          baseline: { mean: 2, deviation: 1.2, buckets: 30 },
          ewma: { fired: false, at: null, statistic: 0, limit: 3, buckets: 0 },
          cusum: { fired: true, at: 46, statistic: 18.4, limit: 14.4, buckets: 16 },
        },
      }),
    );
    render(wrap(<IncidentDetailPage />));

    expect(await screen.findByText(/Cumulative deviation reached 18.40/)).toBeInTheDocument();
    expect(screen.getByText(/after 16 minutes of accumulating/)).toBeInTheDocument();
    // Said plainly, because it is about the shop rather than this entity. A session has no
    // history to have changed from, so attributing the alarm to one would be misleading.
    expect(screen.getByText(/not this entity on its own/)).toBeInTheDocument();
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
