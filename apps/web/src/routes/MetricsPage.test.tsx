import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { RiskModelMetrics } from '@sentinel/contracts';
import { MetricsPage } from './MetricsPage.js';

function metrics(overrides: Partial<RiskModelMetrics> = {}): RiskModelMetrics {
  const interval = (point: number) => ({ point, low: point - 0.05, high: point + 0.05 });
  return {
    provenance: {
      dataSource: 'synthetic-cardtesting',
      modelBackend: 'logistic-temperature',
      dataNote: 'Synthetic scenario corpus, not real-world labels.',
      seed: 20260826,
      nRows: 7018,
      nGroups: 500,
      positiveRate: 0.2,
    },
    honest: {
      model: 'logistic-temperature',
      reviewCap: 0.03,
      nTest: 1695,
      positives: 379,
      threshold: 0.07,
      precision: interval(0.813),
      recall: interval(0.976),
      f1: interval(0.887),
      prAuc: interval(0.974),
      rocAuc: 0.992,
      brier: 0.031,
      falseDeclineRate: 0.065,
      blockRate: 0.268,
      reviewRate: 0.029,
      reviewThreshold: 0.035,
      reliability: [
        { predicted: 0.1, observed: 0.11 },
        { predicted: 0.8, observed: 0.78 },
      ],
      perOrigin: [
        {
          origin: 'attack_distributed',
          n: 96,
          positive: true,
          recall: 1,
          falsePositiveRate: null,
          meanRisk: 1,
        },
        {
          origin: 'aggressive_dunning',
          n: 36,
          positive: false,
          recall: null,
          falsePositiveRate: 0.972,
          meanRisk: 0.57,
        },
      ],
    },
    baselineNoSkill: { prAuc: 0.224 },
    leakage: {
      honestPrAuc: 0.974,
      naivePrAuc: 0.971,
      delta: -0.003,
      honestGroupOverlap: 0,
      naiveGroupOverlap: 42,
    },
    cost: { falseNegativePaise: 500000, falsePositivePaise: 80000 },
    featureImportance: [
      { feature: 'log_attempts', importance: 0.32 },
      { feature: 'recovery_rate', importance: 0.18 },
    ],
    learningCurve: [{ trainFraction: 1, nTrain: 5000, valPrAuc: 0.97 }],
    ablation: [
      { features: 'all features', nFeatures: 10, prAuc: 0.974 },
      { features: 'entity only (no traffic context)', nFeatures: 7, prAuc: 0.9 },
    ],
    errorTaxonomy: [{ amountBand: 'low', n: 500, falsePositive: 10, falseNegative: 5 }],
    registry: {
      version: 'r1',
      trainingDataHash: 'sha256:abc',
      featureDefinitionVersion: 'fdv-x',
      onnxExported: false,
      metricsSnapshot: { prAuc: 0.974, precision: 0.813, recall: 0.976 },
    },
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
  it('leads with the synthetic disclaimer — these are not real-world labels', async () => {
    stub({ available: true, model: metrics() });
    render(wrap(<MetricsPage />));

    expect(
      await screen.findByText(/These labels are synthetic, not real-world outcomes/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not real-world labels/i)).toBeInTheDocument();
  });

  it('shows the held-out numbers with their intervals and the no-skill floor', async () => {
    stub({ available: true, model: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/0.974\s+\(0.924–1.024\)/)).toBeInTheDocument(); // PR-AUC interval
    expect(screen.getByText(/No-skill PR-AUC floor/)).toBeInTheDocument();
  });

  it('shows the per-origin breakdown — recall on attacks, FP-rate on benign', async () => {
    stub({ available: true, model: metrics() });
    render(wrap(<MetricsPage />));

    expect(
      await screen.findByText(/Where the model is right, and where it is not/i),
    ).toBeInTheDocument();
    expect(screen.getByText('attack_distributed')).toBeInTheDocument();
    expect(screen.getByText(/recall 1.000/)).toBeInTheDocument();
    expect(screen.getByText(/FP 0.972/)).toBeInTheDocument();
  });

  it('shows the three-way operating point and the false-decline rate', async () => {
    stub({ available: true, model: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/operating point, as a desk runs it/i)).toBeInTheDocument();
    expect(screen.getByText('6.50%')).toBeInTheDocument(); // false-decline rate
    expect(screen.getByText(/contain-eligible 26.80%/)).toBeInTheDocument();
  });

  it('renders the calibration reliability diagram', async () => {
    stub({ available: true, model: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText(/do the probabilities mean what they say/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /reliability diagram/i })).toBeInTheDocument();
  });

  it('shows the leakage delta with both split scores', async () => {
    stub({ available: true, model: metrics() });
    render(wrap(<MetricsPage />));

    expect(await screen.findByText('The leakage delta')).toBeInTheDocument();
    expect(screen.getByText('0.971')).toBeInTheDocument(); // careless
  });

  it('says plainly when the model has not been generated', async () => {
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
