import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SimulationRun } from '@sentinel/contracts';
import { RunHistory } from './RunHistory.js';

const T = Date.parse('2026-03-01T09:00:00.000Z');

function run(over: Partial<SimulationRun> = {}): SimulationRun {
  return {
    id: 'run_1',
    family: 'attack_loud',
    scenarioTitle: 'Card enumeration, undisguised',
    classification: 'attack',
    status: 'finished',
    paymentsGenerated: 42,
    attemptsCorrelated: 40,
    incidentsDetected: 1,
    detected: [
      { title: 'Coordinated card testing', severity: 'high', score: 0.91, entityKind: 'session' },
    ],
    startedAt: new Date(T).toISOString(),
    endedAt: new Date(T + 60_000).toISOString(),
    ...over,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
function stub(runs: SimulationRun[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ runs }) })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('RunHistory', () => {
  it('shows durable past runs and their detection snapshot, on the Incidents list', async () => {
    stub([run()]);
    render(wrap(<RunHistory />));

    // The heading renders immediately; wait for the run rows to load from /api/simulation/runs.
    expect(await screen.findByText('Card enumeration, undisguised')).toBeInTheDocument();
    expect(screen.getByText('Run history')).toBeInTheDocument();
    expect(screen.getByText(/42 payments/)).toBeInTheDocument();
    expect(screen.getByText(/Coordinated card testing · 91\/100/)).toBeInTheDocument();
  });

  it('shows an empty state when no simulations have run yet', async () => {
    stub([]);
    render(wrap(<RunHistory />));
    expect(await screen.findByText('Run history')).toBeInTheDocument();
    expect(screen.getByText(/No simulations run yet/)).toBeInTheDocument();
  });
});
