import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { OrdersResponse, ResolvedOrder } from '@sentinel/contracts';
import { AttemptsPage } from './AttemptsPage.js';

const sensor = {
  sessionFingerprint: 'cccccccc',
  deviceFingerprint: 'bbbbbbbb',
  ipFingerprint: 'aaaaaaaa',
  userAgentFamily: 'chrome',
  itemCount: 1,
  createdAt: '2026-08-25T11:15:00.000Z',
};

/** The real sequence from the deployed instance: declined card, then a successful retry. */
const recovered: ResolvedOrder = {
  razorpayOrderId: 'order_TTyyheY7fRMZnW',
  source: 'razorpay',
  outcome: 'paid',
  recovered: true,
  amountPaise: 149_900,
  firstSeenAt: '2026-08-25T11:16:09.000Z',
  lastSeenAt: '2026-08-25T11:18:57.000Z',
  failureCount: 1,
  sensor,
  attempts: [
    {
      razorpayPaymentId: 'pay_TTyzcANZB9mSVn',
      status: 'failed',
      amountPaise: 149_900,
      method: 'card',
      cardNetwork: 'Visa',
      cardIssuer: null,
      failure: {
        code: 'BAD_REQUEST_ERROR',
        reason: 'international_transaction_not_allowed',
        source: 'business',
        step: 'payment_initiation',
        description: 'This business accepts domestic cards only.',
      },
      firstSeenAt: '2026-08-25T11:16:09.000Z',
      lastSeenAt: '2026-08-25T11:16:09.000Z',
      eventCount: 1,
      late: false,
    },
    {
      razorpayPaymentId: 'pay_TTz2PHRSa5mdZp',
      status: 'captured',
      amountPaise: 149_900,
      method: 'card',
      cardNetwork: null,
      cardIssuer: null,
      failure: null,
      firstSeenAt: '2026-08-25T11:18:56.000Z',
      lastSeenAt: '2026-08-25T11:18:57.000Z',
      eventCount: 3,
      late: false,
    },
  ],
};

const allFailed: ResolvedOrder = {
  ...recovered,
  razorpayOrderId: 'order_BAD',
  outcome: 'failed',
  recovered: false,
  failureCount: 2,
  attempts: [recovered.attempts[0]!, { ...recovered.attempts[0]!, razorpayPaymentId: 'pay_X' }],
};

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(body: Partial<OrdersResponse>, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 401,
      json: async () => ({ orders: [], unresolved: [], allowedLatenessMinutes: 5, ...body }),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AttemptsPage', () => {
  it('renders each attempt on the order', async () => {
    stub({ orders: [recovered] });
    render(wrap(<AttemptsPage />));

    expect(await screen.findByText('pay_TTyzcANZB9mSVn')).toBeInTheDocument();
    expect(screen.getByText('pay_TTz2PHRSa5mdZp')).toBeInTheDocument();
    expect(screen.getByText('₹1,499.00')).toBeInTheDocument();
  });

  it('says in words that a decline followed by a payment is a recovery', async () => {
    // The whole point of resolving state rather than counting failures. Leaving the reader to
    // infer it from a green badge next to a red dot would waste the distinction.
    stub({ orders: [recovered] });
    render(wrap(<AttemptsPage />));

    expect(await screen.findByText(/Failed once, then paid/)).toBeInTheDocument();
    expect(screen.getByText(/not as a failure/)).toBeInTheDocument();
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('keeps the failure reason visible on a recovered order', async () => {
    stub({ orders: [recovered] });
    render(wrap(<AttemptsPage />));

    expect(await screen.findByText(/international_transaction_not_allowed/)).toBeInTheDocument();
    expect(screen.getByText(/payment_initiation/)).toBeInTheDocument();
  });

  it('does not call an order where everything failed a recovery', async () => {
    stub({ orders: [allFailed] });
    render(wrap(<AttemptsPage />));

    // Scoped to the order's badge: "failed" also appears once per failed attempt, and
    // matching whichever came first would pass whatever the badge said.
    await screen.findByText('pay_TTyzcANZB9mSVn');
    expect(document.querySelector('.order__badges')).toHaveTextContent('failed');
    expect(screen.queryByText('recovered')).not.toBeInTheDocument();
    expect(screen.queryByText(/then paid/)).not.toBeInTheDocument();
  });

  it('shows the gap a shopper waited between attempts', async () => {
    stub({ orders: [recovered] });
    render(wrap(<AttemptsPage />));
    expect(await screen.findByText('3m later')).toBeInTheDocument();
  });

  it('shows the correlation keys the webhooks never carry', async () => {
    stub({ orders: [recovered] });
    render(wrap(<AttemptsPage />));

    expect(await screen.findByText('cccccccc')).toBeInTheDocument();
    expect(screen.getByText('chrome')).toBeInTheDocument();
  });

  it('reports an abandoned checkout as unresolved rather than failed', async () => {
    stub({
      unresolved: [
        {
          razorpayOrderId: 'order_ABANDONED',
          amountPaise: 49_900,
          createdAt: '2026-08-25T10:00:00.000Z',
          ageMinutes: 60,
          sensor,
        },
      ],
    });

    render(wrap(<AttemptsPage />));
    expect(await screen.findByText('order_ABANDONED')).toBeInTheDocument();
    expect(screen.getByText(/assumed to have failed/i)).toBeInTheDocument();
  });

  it('says nothing has arrived rather than rendering an empty table', async () => {
    stub({});
    render(wrap(<AttemptsPage />));
    expect(await screen.findByText('No payment events yet')).toBeInTheDocument();
  });

  it('surfaces an api failure instead of an empty page', async () => {
    stub({}, false);
    render(wrap(<AttemptsPage />));
    expect(await screen.findByRole('alert')).toHaveTextContent('401');
  });
});
