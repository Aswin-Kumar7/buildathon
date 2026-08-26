import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ModelMetrics } from '@sentinel/contracts';
import { MetricsPage } from './MetricsPage.js';

function metrics(overrides: Partial<ModelMetrics> = {}): ModelMetrics {
  const interval = (point: number) => ({ point, low: point - 0.05, high: point + 0.05 });
  return {
    provenance: {
      dataSource: 'synthetic',
      modelBackend: 'sklearn-histgb',
      dataNote: 'Synthetic stand-in — the competition data cannot be redistributed.',
      seed: 20260826,
      nRows: 15000,
      nUids: 1200,
      fraudRate: 0.13,
    },
    honest: {
      model: 'sklearn-histgb',
      threshold: 0.4,
      nTest: 3000,
      positives: 400,
      precision: interval(0.62),
      recall: interval(0.4),
      prAuc: interval(0.52),
      rocAuc: 0.86,
      brier: 0.086,
      reviewCap: 0.01,
      falseDeclineRate: 0.05,
      blockRate: 0.1,
      reviewRate: 0.0098,
      reviewThreshold: 0.25,
      reliability: [
        { predicted: 0.1, observed: 0.11 },
        { predicted: 0.4, observed: 0.38 },
      ],
    },
    baselineLogisticPrAuc: 0.63,
    leakage: {
      honestPrAuc: 0.517,
      naivePrAuc: 0.625,
      delta: 0.109,
      honestUidOverlap: 0,
      naiveUidOverlap: 1560,
      droppedToGap: 542,
    },
    cost: { falseNegativePaise: 300000, falsePositivePaise: 120000 },
    featureImportance: [
      { feature: 'C1', importance: 0.175 },
      { feature: 'card1', importance: 0.001 },
    ],
    learningCurve: [{ trainFraction: 1, nTrain: 8000, valPrAuc: 0.52 }],
    errorTaxonomy: [{ amountBand: 'low', n: 1000, falsePositive: 10, falseNegative: 20 }],
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })),
  );
}

describe('MetricsPage', () => {
  it('leads with the leakage delta, both split scores side by side', async () => {
    stub({ available: true, metrics: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText('The leakage delta')).toBeInTheDocument();
    expect(screen.getByText('0.625')).toBeInTheDocument(); // careless, inflated
    expect(screen.getByText('0.517')).toBeInTheDocument(); // honest
    expect(screen.getByText('1,560')).toBeInTheDocument(); // cards shared by the careless split
  });

  it('labels the evidence level on the numbers', async () => {
    // On synthetic data the scores are a property of the generator, not IEEE-CIS, and the page
    // must say so rather than let a reader mistake one for the other.
    stub({ available: true, metrics: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText('synthetic stand-in')).toBeInTheDocument();
    expect(screen.getByText(/cannot be redistributed/)).toBeInTheDocument();
  });

  it('marks real held-out data differently', async () => {
    stub({
      available: true,
      metrics: metrics({
        provenance: { ...metrics().provenance, dataSource: 'ieee-cis', dataNote: 'real held-out' },
      }),
    });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText('IEEE-CIS held-out')).toBeInTheDocument();
  });

  it('shows the held-out numbers with their intervals', async () => {
    stub({ available: true, metrics: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/0.620\s+\(0.570–0.670\)/)).toBeInTheDocument();
    expect(screen.getByText(/Logistic baseline/)).toBeInTheDocument();
  });

  it('shows the three-way operating point, capped review, and the false-decline rate', async () => {
    stub({ available: true, metrics: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/operating point, as a desk runs it/i)).toBeInTheDocument();
    // The number a merchant feels, stated outright.
    expect(screen.getByText('5.00%')).toBeInTheDocument(); // false-decline rate
    // Review is a capacity, shown against its budget.
    expect(screen.getByText(/of 1.00% budget/)).toBeInTheDocument();
    expect(screen.getByText(/block 10.00%/)).toBeInTheDocument(); // the three-way bar segment
  });

  it('renders the calibration reliability diagram', async () => {
    stub({ available: true, metrics: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/do the probabilities mean what they say/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /reliability diagram/i })).toBeInTheDocument();
  });

  it('says plainly when the benchmark has not been generated', async () => {
    stub({ available: false, reason: 'Run make eval to produce it.' });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/has not been generated/)).toBeInTheDocument();
    expect(screen.getByText(/Run make eval/)).toBeInTheDocument();
  });

  it('surfaces a load failure rather than an empty page', async () => {
    stub({}, false);
    render(wrap(<MetricsPage />));
    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 500');
  });
});
