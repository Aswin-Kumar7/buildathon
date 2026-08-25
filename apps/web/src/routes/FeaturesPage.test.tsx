import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FeatureRankResponse, FeatureVectorDto } from '@sentinel/contracts';
import { FeaturesPage } from './FeaturesPage.js';

const T0 = Date.parse('2026-03-01T09:30:00.000Z');

function vector(overrides: Partial<FeatureVectorDto> = {}): FeatureVectorDto {
  return {
    entityKind: 'session',
    entityKey: 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    asOf: T0,
    window: { windowMs: 1_800_000, halfLifeMs: 300_000 },
    attemptRate: 2.1,
    failureRate: 1.9,
    distinctCards: { estimate: 41, errorBound: 1, exact: 40 },
    distinctSessions: { estimate: 1, errorBound: 1, exact: 1 },
    distinctNetworks: { estimate: 1, errorBound: 1, exact: 1 },
    attempts: 63,
    failures: 61,
    approvalRate: 0.03,
    infrastructureFailureShare: 0,
    reasonConcentration: 0.4,
    medianAmountPaise: 4900,
    smallAmountShare: 0.8,
    burstiness: 0.2,
    recoveryRate: 0,
    recoveredOrders: 0,
    lastSeenAt: T0 - 120_000,
    ...overrides,
  };
}

function response(overrides: Partial<FeatureRankResponse> = {}): FeatureRankResponse {
  return {
    candidates: 12,
    vectors: [vector()],
    asOf: T0,
    generatedAt: T0 + 60_000,
    newestObservationAt: T0,
    basis: 'now',
    source: 'all',
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(body: FeatureRankResponse | (() => FeatureRankResponse)): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => (typeof body === 'function' ? body() : body),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('FeaturesPage', () => {
  it('shows the exact count and the sketch estimate side by side', async () => {
    // The requirement the whole slice exists to satisfy. A reader must be able to tell which
    // number is confirmed and which is approximate, without knowing how either was produced.
    stub(response());
    render(wrap(<FeaturesPage />));

    expect(await screen.findByText('Distinct cards')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText(/sketch 41 ±1/)).toBeInTheDocument();
  });

  it('says how far the sketch was off', async () => {
    stub(response());
    render(wrap(<FeaturesPage />));

    expect(await screen.findByText(/Sketch was over by 1/)).toBeInTheDocument();
  });

  it('says outright when an estimate has not been confirmed', async () => {
    // An unconfirmed sketch value must never read like a fact. If the confirmation pass were
    // ever skipped, the page has to say so rather than print the estimate as though it counted.
    stub(
      response({
        vectors: [vector({ distinctCards: { estimate: 41, errorBound: 1, exact: null } })],
      }),
    );
    render(wrap(<FeaturesPage />));

    expect(await screen.findByText(/not confirmed, so not decidable on/)).toBeInTheDocument();
  });

  it('states the window and the half-life the rates were computed over', async () => {
    stub(response());
    render(wrap(<FeaturesPage />));

    expect(await screen.findByText(/30-minute window, 5-minute half-life/)).toBeInTheDocument();
  });

  it('reports freshness for the entity', async () => {
    stub(response());
    render(wrap(<FeaturesPage />));

    expect(await screen.findByText(/Last attempt 2m ago/)).toBeInTheDocument();
  });

  it('warns when the numbers describe a past moment rather than now', async () => {
    // A replayed scenario carries its recorded timestamps. Its rates are real but historical,
    // and presenting them without saying so would be a lie by omission.
    stub(response({ basis: 'last-activity', generatedAt: T0 + 7_200_000 }));
    render(wrap(<FeaturesPage />));

    expect(
      await screen.findByText(/Evaluated as of the last activity, not now/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it('does not warn when the numbers are current', async () => {
    stub(response());
    render(wrap(<FeaturesPage />));

    await screen.findByText('Distinct cards');
    expect(screen.queryByText(/Evaluated as of the last activity/)).not.toBeInTheDocument();
  });

  it('refetches for the entity kind the analyst picks', async () => {
    const fetchMock = stub(response());
    render(wrap(<FeaturesPage />));
    await screen.findByText('Distinct cards');

    await userEvent.click(screen.getByRole('button', { name: 'network' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/features/network?source=all', expect.anything());
  });

  it('separates real traffic from replayed traffic', async () => {
    // The same separation the health page makes. Merging them would let replayed events pass
    // as evidence, and would also hide every replayed scenario behind one live attempt.
    const fetchMock = stub(response());
    render(wrap(<FeaturesPage />));
    await screen.findByText('Distinct cards');

    await userEvent.click(screen.getByRole('button', { name: 'Replayed' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/features/session?source=replay',
      expect.anything(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Real traffic' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/features/session?source=razorpay',
      expect.anything(),
    );
  });

  it('says what to do when there is nothing to compute from', async () => {
    stub(response({ candidates: 0, vectors: [], newestObservationAt: null }));
    render(wrap(<FeaturesPage />));

    expect(await screen.findByText(/Nothing to compute from/)).toBeInTheDocument();
    expect(screen.getByText(/Replay a scenario/)).toBeInTheDocument();
  });

  it('surfaces a failure instead of rendering an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    render(wrap(<FeaturesPage />));

    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 500');
  });

  it('rejects a malformed vector rather than rendering a plausible wrong number', async () => {
    // Parsed through the contract, not cast. A field that arrived as a string would otherwise
    // render as something a reader could mistake for a measurement.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ...response(), candidates: 'lots' }),
      })),
    );
    render(wrap(<FeaturesPage />));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
