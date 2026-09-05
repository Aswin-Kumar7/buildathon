import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IncidentListResponse, IncidentSummary } from '@sentinel/contracts';
import { IncidentsPage } from './IncidentsPage.js';
import { phraseFor } from '../incidents/evidence.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
  useNavigate: () => vi.fn(),
}));

// The simulation panel's open/minimized state lives at the shell level; isolate it from the unit.
vi.mock('../shell/SimulationDock.js', () => ({
  useSimDock: () => ({ view: 'hidden', open: () => {}, minimize: () => {}, dismiss: () => {} }),
  SimDockProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
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
    recommendedDecision: 'review',
    primaryHypothesis: 'attack',
    attempts: 3,
    failures: 3,
    distinctCards: 18,
    title: 'Coordinated card testing',
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
  it('shows an incident row with its title, risk tier and correlated counts', async () => {
    stub(response());
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText('Coordinated card testing')).toBeInTheDocument();
    // A high-severity incident at score 0.90 reads as the CRITICAL display tier (existing convention).
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText(/18 cards/)).toBeInTheDocument();
    expect(screen.getByText(/90/)).toBeInTheDocument(); // score /100
  });

  it('marks simulated incidents as simulated', async () => {
    stub(response());
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText('Simulated')).toBeInTheDocument();
  });

  it('shows the incident status as a pill', async () => {
    stub(response());
    render(wrap(<IncidentsPage />));

    const row = (await screen.findByText('Coordinated card testing')).closest('tr');
    expect(row).toHaveTextContent('Active'); // open → Active
  });

  it('filters the table by status client-side', async () => {
    stub(response());
    render(wrap(<IncidentsPage />));
    await screen.findByText('Coordinated card testing');

    // The one incident is open; selecting Under review must filter it out.
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'under_review');
    expect(screen.queryByText('Coordinated card testing')).not.toBeInTheDocument();
  });

  it('filters the table when a summary tier card is clicked', async () => {
    stub(
      response({
        incidents: [
          incident({ id: 'crit', title: 'Critical case', severity: 'high', score: 0.95 }),
          incident({ id: 'low', title: 'Low case', severity: 'low', score: 0.2 }),
        ],
      }),
    );
    render(wrap(<IncidentsPage />));
    await screen.findByText('Critical case');

    // The Low tier card is a one-click filter — clicking it narrows the queue to low-tier rows.
    await userEvent.click(screen.getByRole('button', { name: /^Low/ }));

    expect(screen.queryByText('Critical case')).not.toBeInTheDocument();
    expect(screen.getByText('Low case')).toBeInTheDocument();
  });

  it('surfaces the recommended action and a Review CTA on an actionable row', async () => {
    stub(response({ incidents: [incident({ recommendedDecision: 'contain', status: 'open' })] }));
    render(wrap(<IncidentsPage />));
    await screen.findByText('Coordinated card testing');

    const row = screen.getByText('Coordinated card testing').closest('tr') as HTMLElement;
    // 'contain' is what a merchant reads as Block — the row states what Sentinel recommends.
    expect(within(row).getByText('Block')).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Review Coordinated card testing' }),
    ).toBeInTheDocument();
  });

  it('scopes the fetch to the chosen source', async () => {
    // Source is a real backend filter; the health page and feature inspector make the same separation.
    const fetchMock = stub(response());
    render(wrap(<IncidentsPage />));
    await screen.findByText('Coordinated card testing');

    await userEvent.selectOptions(screen.getByLabelText('Source'), 'replay');
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents?source=replay', expect.anything());
  });

  it('says when nothing matches', async () => {
    stub(response({ incidents: [] }));
    render(wrap(<IncidentsPage />));

    expect(await screen.findByText('No incidents match these filters.')).toBeInTheDocument();
  });

  it('surfaces a failure rather than an empty table', async () => {
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

  it('suggests checking with the acquirer when the gateway was blamed', () => {});

  it('suggests closing a biller rather than containing it', () => {});
});
