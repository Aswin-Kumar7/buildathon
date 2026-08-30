import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SimulationStatus } from '@sentinel/contracts';
import { SimulationPanel } from './SimulationPanel.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

const T = Date.parse('2026-03-01T09:00:00.000Z');

function status(over: Partial<SimulationStatus> = {}): SimulationStatus {
  return {
    running: true,
    phase: 'incident',
    emitted: 40,
    total: 107,
    attemptsCorrelated: 38,
    incidentsDetected: 1,
    evaluations: 4,
    startedAt: new Date(T).toISOString(),
    scenario: {
      family: 'attack_loud',
      title: 'Card enumeration, undisguised',
      description: 'One machine working through a list of card numbers.',
      classification: 'attack',
    },
    recentActivity: [
      {
        at: T,
        kind: 'payment',
        paymentId: 'pay_abcd1234',
        status: 'failed',
        amountPaise: 1000,
        method: 'card',
        title: null,
        severity: null,
        incidentId: null,
      },
    ],
    detected: [
      {
        id: 'a1',
        title: 'Coordinated card testing',
        severity: 'high',
        score: 0.9,
        status: 'open',
        entityKind: 'session',
      },
    ],
    stoodDown: [],
    ...over,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
// Route-aware so the panel's two polls — /status and /runs — each get the right shape.
function stub(body: SimulationStatus): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes('/runs') ? { runs: [] } : body),
    })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('SimulationPanel', () => {
  it('renders real run state — scenario, metrics, the detected incident, no countdown', async () => {
    stub(status());
    render(wrap(<SimulationPanel onClose={() => {}} onTick={() => {}} />));

    expect(await screen.findByText('Card enumeration, undisguised')).toBeInTheDocument();
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
    // Real backend metrics, not frontend counters.
    expect(screen.getByText('40')).toBeInTheDocument(); // payments generated
    expect(screen.getByText('38')).toBeInTheDocument(); // attempts correlated
    // What Sentinel actually detected — distinct from the scenario that was generated.
    expect(screen.getByText('Coordinated card testing')).toBeInTheDocument();
    expect(screen.getByText('Stop simulation')).toBeInTheDocument();
    // No time-remaining / countdown anywhere.
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
  });

  it('reports honestly when the run produced no incident', async () => {
    stub(status({ running: false, phase: 'analyzing', incidentsDetected: 0, detected: [] }));
    render(wrap(<SimulationPanel onClose={() => {}} onTick={() => {}} />));

    expect(await screen.findByText(/No incident opened/)).toBeInTheDocument();
    expect(screen.getByText('Simulation finished')).toBeInTheDocument();
    // A finished run offers no Stop control.
    expect(screen.queryByText('Stop simulation')).not.toBeInTheDocument();
  });

  it('explains WHY a benign run is not an incident, so a correct clean run is not read as a failure', async () => {
    stub(
      status({
        running: false,
        phase: 'analyzing',
        incidentsDetected: 0,
        detected: [],
        scenario: {
          family: 'normal_traffic',
          title: 'An ordinary hour',
          description: 'Ordinary shoppers paying across UPI, cards and netbanking.',
          classification: 'benign',
        },
      }),
    );
    render(wrap(<SimulationPanel onClose={() => {}} onTick={() => {}} />));

    // Positive verdict + the reason, not a bare "nothing found".
    expect(await screen.findByText(/that is the right call/i)).toBeInTheDocument();
    expect(screen.getByText(/only when payments match an abuse pattern/i)).toBeInTheDocument();
  });

  it('surfaces an opened-then-stood-down incident as judgment, not a detection', async () => {
    stub(
      status({
        stoodDown: [
          {
            id: 's1',
            title: 'Coordinated card testing',
            severity: 'medium',
            entityKind: 'session',
            resolvedAs: 'retry storm',
          },
        ],
      }),
    );
    render(wrap(<SimulationPanel onClose={() => {}} onTick={() => {}} />));

    expect(await screen.findByText('Opened, then stood down')).toBeInTheDocument();
    expect(screen.getByText(/Re-classified as retry storm/)).toBeInTheDocument();
    expect(screen.getByText('stood down')).toBeInTheDocument();
  });
});
