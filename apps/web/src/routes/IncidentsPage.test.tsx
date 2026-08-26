import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IncidentListResponse, IncidentSummary } from '@sentinel/contracts';
import { IncidentsPage } from './IncidentsPage.js';
import { phraseFor, suggestedAction } from '../incidents/evidence.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

function incident(overrides: Partial<IncidentSummary> = {}): IncidentSummary {
  return {
    id: 'a1',
    key: 'session:v1:abcdef:1',
    entityKind: 'session',
    entityKey: 'v1:abcdef0123456789',
    status: 'open',
    severity: 'high',
    score: 0.9,
    scoreLower: 0.9,
    scoreUpper: 0.9,
    band: 'high',
    firstAttemptAt: T0,
    detectedAt: T0 + 300_000,
    lastActivityAt: T0 + 290_000,
    expiresAt: T0 + 2_090_000,
    timeToDetectMs: 300_000,
    observations: 3,
    source: 'replay',
    firedRules: ['card_spread', 'approval_collapse'],
    ...overrides,
  };
}

function response(overrides: Partial<IncidentListResponse> = {}): IncidentListResponse {
  return {
    incidents: [incident()],
    counts: { open: 1, underReview: 0, contained: 0, resolved: 0, expired: 0 },
    thresholdHash: 'a1b2c3d4',
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(body: IncidentListResponse): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('IncidentsPage', () => {
  it('shows one row per episode with what it would take to act', async () => {
    stub(response());
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText(/Card spread/)).toBeInTheDocument();
    expect(screen.getByText('0.90')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('marks replayed incidents as replayed', async () => {
    // The same separation the health page and the feature inspector make. A replayed incident
    // is not evidence the system works against Razorpay.
    stub(response());
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText(/replayed/)).toBeInTheDocument();
  });

  it('flags a wide band when the score is not confident', async () => {
    stub(response({ incidents: [incident({ band: 'medium', scoreLower: 0.5, scoreUpper: 0.9 })] }));
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText(/wide band/i)).toBeInTheDocument();
  });

  it('names the threshold set that judged them', async () => {
    // A score without the thresholds that produced it is a number nobody can argue with.
    stub(response());
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText('a1b2c3d4')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const fetchMock = stub(response());
    render(wrap(<IncidentsPage />));
    await screen.findByText(/Card spread/);

    await userEvent.click(screen.getByRole('tab', { name: 'Contained' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents?status=contained', expect.anything());
  });

  it('separates real traffic from replayed, and scopes detection to it', async () => {
    // The same separation the health page and the feature inspector make. Evaluating everything
    // while showing one source would let a replayed scenario hide behind a single live attempt.
    const fetchMock = stub(response());
    render(wrap(<IncidentsPage />));
    await screen.findByText(/Card spread/);

    await userEvent.click(screen.getByRole('button', { name: 'Replayed' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents?source=replay', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Run detection' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents/evaluate?source=replay',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('says what to do when the queue is empty', async () => {
    stub(response({ incidents: [] }));
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText(/Nothing in the queue/)).toBeInTheDocument();
    expect(screen.getByText(/Run a simulation/)).toBeInTheDocument();
  });

  it('surfaces a failure rather than an empty queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    render(wrap(<IncidentsPage />));

    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 500');
  });
});

describe('rendering evidence', () => {
  it('turns a code and two numbers into a sentence', () => {
    // The rules emit codes so a reason can be counted and tested. The wording lives here, and
    // changing it cannot change what the detector concluded.
    expect(
      phraseFor({
        rule: 'card_spread',
        code: 'distinct_cards_above_threshold',
        observed: 40,
        threshold: 8,
        weight: 0.35,
      }),
    ).toContain('40 different cards');
  });

  it('still shows the numbers for a code it has no wording for', () => {
    // A missing sentence must not hide the fact. The observation and the threshold are what
    // actually happened.
    const rendered = phraseFor({
      rule: 'velocity',
      code: 'some_new_rule_nobody_worded',
      observed: 7,
      threshold: 3,
      weight: 0.1,
    });

    expect(rendered).toContain('7');
    expect(rendered).toContain('3');
  });

  it('suggests checking with the acquirer when the gateway was blamed', () => {
    expect(suggestedAction('high', ['infrastructure_attribution'])).toMatch(/acquirer/i);
  });

  it('suggests closing a biller rather than containing it', () => {
    expect(suggestedAction('medium', ['card_reuse'])).toMatch(/biller/i);
  });
});
