import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IngestionMetrics } from '@sentinel/contracts';
import { HealthPage } from './HealthPage.js';

const healthy: IngestionMetrics = {
  configured: true,
  eventsStored: 128,
  canonicalEvents: 128,
  duplicateDeliveries: 12,
  duplicateRate: 12 / 140,
  eventsPerMinute: 3.4,
  pendingDepth: 0,
  deadLetterDepth: 0,
  lateEvents: 2,
  lastEventReceivedAt: new Date(Date.now() - 20_000).toISOString(),
  oldestPendingAgeMs: null,
  meanProcessingMs: 42,
  watermark: '2026-01-01T00:00:00.000Z',
  allowedLatenessMinutes: 5,
  maxAttempts: 3,
};

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(metrics: Partial<IngestionMetrics> = {}, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 401,
      json: async () => ({ ...healthy, ...metrics }),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Reads one metric by its label. `getByText('128')` would match whichever card happened
 * to come first, so a bug that swapped two equal-valued metrics would pass.
 */
function metric(label: string): HTMLElement {
  const term = screen.getByText(label);
  const card = term.closest('.metric');
  if (card === null) throw new Error(`no metric card for ${label}`);
  return card as HTMLElement;
}

describe('HealthPage', () => {
  it('reports the counts that say whether ingestion is working', async () => {
    stub();
    render(wrap(<HealthPage />));

    await screen.findByText('Events stored');
    expect(metric('Events stored')).toHaveTextContent('128');
    expect(metric('Canonical events')).toHaveTextContent('128');
    expect(metric('Arriving')).toHaveTextContent('3.4/min');
    expect(metric('Duplicates')).toHaveTextContent('8.6%');
  });

  it('says plainly when ingestion is configured', async () => {
    stub();
    render(wrap(<HealthPage />));
    expect(await screen.findByText('Webhook ingestion is configured')).toBeInTheDocument();
  });

  it('distinguishes an unconfigured webhook from a quiet one', async () => {
    // The failure this guards: every count is zero in both cases, so a page that only
    // shows numbers reports "all quiet" for the entire duration of an outage.
    stub({
      configured: false,
      eventsStored: 0,
      canonicalEvents: 0,
      duplicateDeliveries: 0,
      duplicateRate: 0,
      eventsPerMinute: 0,
      lateEvents: 0,
      lastEventReceivedAt: null,
      watermark: null,
    });

    render(wrap(<HealthPage />));
    expect(await screen.findByText('Webhook ingestion is not configured')).toBeInTheDocument();
    expect(screen.getByText(/nothing can arrive/i)).toBeInTheDocument();
  });

  it('flags a dead-letter queue that is not empty', async () => {
    stub({ deadLetterDepth: 4 });
    render(wrap(<HealthPage />));

    await screen.findByText('Dead-lettered');
    expect(metric('Dead-lettered')).toHaveClass('metric--critical');
    expect(metric('Dead-lettered')).toHaveTextContent('4');
  });

  it('leaves the dead-letter card unflagged when it is empty', async () => {
    stub();
    render(wrap(<HealthPage />));

    expect(await screen.findByText('Gave up after 3 attempts')).toBeInTheDocument();
    expect(document.querySelector('.metric--critical')).toBeNull();
  });

  it('warns when the oldest waiting event has been waiting too long', async () => {
    stub({ pendingDepth: 9, oldestPendingAgeMs: 45_000 });
    render(wrap(<HealthPage />));

    expect(await screen.findByText('Oldest has waited 45.0s')).toBeInTheDocument();
    expect(metric('Waiting')).toHaveClass('metric--warn');
  });

  it('does not warn on a queue that is merely busy', async () => {
    stub({ pendingDepth: 9, oldestPendingAgeMs: 800 });
    render(wrap(<HealthPage />));

    expect(await screen.findByText('Oldest has waited 800ms')).toBeInTheDocument();
    expect(document.querySelector('.metric--warn')).toBeNull();
  });

  it('says never rather than showing an empty timestamp', async () => {
    stub({ lastEventReceivedAt: null });
    render(wrap(<HealthPage />));
    expect(await screen.findByText('never')).toBeInTheDocument();
  });

  it('explains that a late event does not rewrite a past decision', async () => {
    stub();
    render(wrap(<HealthPage />));
    expect(await screen.findByText(/never silently rewrites a decision/i)).toBeInTheDocument();
  });

  it('surfaces an api failure instead of rendering zeroes', async () => {
    stub({}, false);
    render(wrap(<HealthPage />));
    expect(await screen.findByRole('alert')).toHaveTextContent('401');
  });
});
