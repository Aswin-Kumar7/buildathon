import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PercentilesDto, SystemHealthDto } from '@sentinel/contracts';
import { SystemLoad } from './SystemLoad.js';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const pct = (over: Partial<PercentilesDto> = {}): PercentilesDto => ({
  count: 100,
  p50: 30,
  p95: 40,
  p99: 45,
  p999: 50,
  max: 55,
  ...over,
});

function health(over: Partial<SystemHealthDto> = {}): SystemHealthDto {
  return {
    sloMs: 200,
    inFlight: 1,
    queueDepth: 0,
    poolSize: 4,
    featureFetch: pct(),
    inference: pct({ p99: 1 }),
    warmPath: pct({ p99: 45 }),
    ingestion: pct({ p99: 2 }),
    shedding: [],
    shed: { CRITICAL_PLUS: 0, CRITICAL: 0, SHEDDABLE_PLUS: 0, SHEDDABLE: 0 },
    ran: { CRITICAL_PLUS: 10, CRITICAL: 0, SHEDDABLE_PLUS: 10, SHEDDABLE: 10 },
    ...over,
  };
}

function mockFetch(dto: SystemHealthDto) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ health: dto }) } as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('SystemLoad', () => {
  it('shows the critical tiers as protected even when nothing is shedding', async () => {
    mockFetch(health());
    render(wrap(<SystemLoad />));
    await screen.findByText(/Under load/i);
    // Ingestion is always protected; with nothing shed, the sheddable tiers read as serving.
    expect(screen.getAllByText(/protected/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/serving/i).length).toBeGreaterThanOrEqual(2);
  });

  it('marks the tail as breached and shows enrichment shedding under load', async () => {
    mockFetch(
      health({
        warmPath: pct({ p99: 50_000 }),
        queueDepth: 6,
        shedding: ['SHEDDABLE_PLUS', 'SHEDDABLE'],
        shed: { CRITICAL_PLUS: 0, CRITICAL: 0, SHEDDABLE_PLUS: 15_597, SHEDDABLE: 15_597 },
      }),
    );
    render(wrap(<SystemLoad />));
    await screen.findByText(/Under load/i);
    // Two sheddable tiers now read as shedding; ingestion is still protected.
    expect(screen.getAllByText(/shedding/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/protected/i).length).toBeGreaterThanOrEqual(2);
    // The shed count is surfaced.
    expect(screen.getAllByText(/shed 15,597/).length).toBeGreaterThanOrEqual(1);
  });

  it('reports an error rather than blanking when health cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    render(wrap(<SystemLoad />));
    await screen.findByRole('alert');
  });
});
