import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AttemptDetail } from '@sentinel/contracts';
import { AttemptDetailPage } from './AttemptDetailPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
  useParams: () => ({ paymentId: 'pay_1' }),
}));

const ISO = '2026-08-26T09:42:13.000Z';

function detail(overrides: Partial<AttemptDetail> = {}): AttemptDetail {
  return {
    payment: {
      paymentId: 'pay_1',
      orderId: 'order_1',
      amountPaise: 10_000,
      currency: 'INR',
      method: 'card',
      status: 'failed',
      captured: false,
      refunded: false,
      cardNetwork: 'visa',
      cardType: 'credit',
      cardIssuer: 'HDFC Bank',
      cardFingerprint: '3a9c1b2d',
      international: false,
      failure: {
        code: 'BAD_REQUEST_ERROR',
        reason: 'insufficient_funds',
        source: 'bank',
        step: 'authorization',
        description: 'Insufficient balance',
      },
      firstSeenAt: ISO,
      lastSeenAt: ISO,
      eventCount: 2,
      late: false,
      source: 'razorpay',
    },
    context: {
      sessionFingerprint: 'aaaa1111',
      deviceFingerprint: 'bbbb2222',
      ipFingerprint: 'cccc3333',
      userAgentFamily: 'Chrome',
      itemCount: 1,
      createdAt: ISO,
    },
    incident: {
      id: 'inc-1',
      ref: 'INC-0245',
      title: 'Coordinated card testing',
      severity: 'high',
      status: 'open',
      entityKind: 'device',
      reason: 'One device attempted many distinct cards in a short window.',
      attempts: 43,
      distinctCards: 18,
      distinctDevices: 1,
      distinctSessions: 3,
      windowMs: 134_000,
    },
    signals: {
      observedAt: ISO,
      windowSeconds: 60,
      attemptsInWindow: 6,
      failuresInWindow: 5,
      failureRate: 5 / 6,
      deviceSeenBefore: true,
      networkDistinctDevices: 2,
      networkWindowSeconds: 600,
      cardReuseInWindow: 0,
      amountVsTypical: 'typical',
      typicalAmountPaise: 250_000,
    },
    recentFromDevice: [
      {
        paymentId: 'pay_1',
        at: ISO,
        amountPaise: 10_000,
        cardNetwork: 'visa',
        cardFingerprint: '3a9c1b2d',
        status: 'failed',
        isCurrent: true,
      },
    ],
    rawEvents: [{ eventType: 'payment.failed', status: 'failed' }],
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(attempt: AttemptDetail): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ attempt }) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AttemptDetailPage', () => {
  it('describes the payment and its failure without a per-attempt score', async () => {
    stub(detail());
    render(wrap(<AttemptDetailPage />));

    expect(await screen.findByText('Payment details')).toBeInTheDocument();
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
    // The invariant of the whole project, said on the page itself.
    expect(screen.getByText(/not an incident on its own/i)).toBeInTheDocument();
  });

  it('shows the incident this attempt was correlated into, with a way to open it', async () => {
    stub(detail());
    render(wrap(<AttemptDetailPage />));

    expect(await screen.findByText('Coordinated card testing')).toBeInTheDocument();
    expect(
      screen.getByText('One device attempted many distinct cards in a short window.'),
    ).toBeInTheDocument();
    expect(screen.getByText('View incident →')).toBeInTheDocument();
  });

  it('presents monitoring signals as observations, not a verdict', async () => {
    stub(detail());
    render(wrap(<AttemptDetailPage />));

    expect(await screen.findByText('Velocity')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/Risk is evaluated only after correlating/i)).toBeInTheDocument();
  });

  it('reads an unlinked attempt as standalone and admits when it cannot observe', async () => {
    stub(detail({ incident: null, signals: null, context: null, recentFromDevice: [] }));
    render(wrap(<AttemptDetailPage />));

    expect(await screen.findByText('Standalone attempt')).toBeInTheDocument();
    expect(screen.getByText(/No checkout context was captured/i)).toBeInTheDocument();
  });

  it('surfaces a failure rather than a blank page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    render(wrap(<AttemptDetailPage />));

    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 404');
  });
});
