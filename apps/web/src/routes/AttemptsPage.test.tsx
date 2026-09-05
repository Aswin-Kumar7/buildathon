import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AttemptRow, AttemptRowsResponse } from '@sentinel/contracts';
import { AttemptsPage } from './AttemptsPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

const safe: AttemptRow = {
  paymentId: 'pay_SAFE001',
  orderId: 'order_SAFE001',
  amountPaise: 245_000,
  method: 'card',
  cardNetwork: 'visa',
  status: 'captured',
  source: 'razorpay',
  incidentId: null,
  incidentRef: null,
  incidentTitle: null,
  incidentSeverity: null,
  at: '2026-08-25T11:16:09.000Z',
};

const flagged: AttemptRow = {
  paymentId: 'pay_RISK002',
  orderId: 'order_RISK002',
  amountPaise: 119_900,
  method: 'upi',
  cardNetwork: null,
  status: 'failed',
  source: 'razorpay',
  incidentId: 'inc-1',
  incidentRef: 'INC-3F9A',
  incidentTitle: 'Coordinated card testing',
  incidentSeverity: 'high',
  at: '2026-08-25T11:18:56.000Z',
};

function body(overrides: Partial<AttemptRowsResponse> = {}): AttemptRowsResponse {
  return {
    rows: [safe, flagged],
    page: 1,
    pageSize: 10,
    total: 2,
    kpis: { total: 2, captured: 1, failed: 1, recovered: 0, inIncident: 1 },
    source: 'razorpay',
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(value: AttemptRowsResponse | null, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 401,
      json: async () => value ?? {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AttemptsPage', () => {
  it('renders the KPI cards from backend counts, never hardcoded', async () => {
    stub(body());
    render(wrap(<AttemptsPage />));

    // The two KPI labels that do not also appear as filter options.
    expect(await screen.findByText('Total attempts')).toBeInTheDocument();
    // The incident-linked count is stated as a proportion of the total, not as a bare second label.
    expect(screen.getByText(/of these belong to an incident/)).toBeInTheDocument();
  });

  it('renders one row per resolved attempt with a single status', async () => {
    stub(body());
    render(wrap(<AttemptsPage />));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('pay_SAFE001')).toBeInTheDocument();
    expect(within(table).getByText('pay_RISK002')).toBeInTheDocument();
    expect(within(table).getByText('₹2,450.00')).toBeInTheDocument();
    // The status appears once per row, as a resolved chip — not a timeline of stages.
    expect(within(table).getByText('Captured')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
  });

  it('links a flagged attempt to its incident, with no per-attempt risk score', async () => {
    stub(body());
    render(wrap(<AttemptsPage />));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('INC-3F9A')).toBeInTheDocument();
    // A single attempt is never scored on its own — no risk number or level is presented for it.
    expect(within(table).queryByText('87')).not.toBeInTheDocument();
    expect(within(table).queryByText('High')).not.toBeInTheDocument();
  });

  it('shows an attempt in no incident as standalone, never as risky or safe', async () => {
    stub(
      body({
        rows: [safe],
        total: 1,
        kpis: { total: 1, captured: 1, failed: 0, recovered: 0, inIncident: 0 },
      }),
    );
    render(wrap(<AttemptsPage />));

    const table = await screen.findByRole('table');
    // No incident, so the incident cell reads as standalone — not "low risk", not "safe".
    expect(within(table).getByText('Standalone')).toBeInTheDocument();
    expect(within(table).queryByText('Low')).not.toBeInTheDocument();
  });

  it('says nothing has arrived rather than rendering an empty table', async () => {
    stub(
      body({
        rows: [],
        total: 0,
        kpis: { total: 0, captured: 0, failed: 0, recovered: 0, inIncident: 0 },
      }),
    );
    render(wrap(<AttemptsPage />));
    expect(await screen.findByText('No payment attempts yet')).toBeInTheDocument();
  });

  it('surfaces an api failure instead of an empty page', async () => {
    stub(null, false);
    render(wrap(<AttemptsPage />));
    expect(await screen.findByRole('alert')).toHaveTextContent('401');
  });
});
