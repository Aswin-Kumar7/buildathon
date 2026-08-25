import { describe, expect, it } from 'vitest';
import { resolveAttempt, resolveOrder, type AttemptEvent } from './state.js';

function event(overrides: Partial<AttemptEvent> & { eventType: string }): AttemptEvent {
  return {
    razorpayPaymentId: 'pay_A',
    razorpayOrderId: 'order_1',
    status: null,
    method: 'card',
    errorCode: null,
    errorReason: null,
    errorSource: null,
    errorStep: null,
    errorDescription: null,
    cardNetwork: null,
    cardIssuer: null,
    amountPaise: 149_900,
    eventAt: new Date('2026-01-01T00:00:00Z'),
    late: false,
    ...overrides,
  };
}

const failed = (id: string, at: string) =>
  event({
    eventType: 'payment.failed',
    razorpayPaymentId: id,
    eventAt: new Date(at),
    errorCode: 'BAD_REQUEST_ERROR',
    errorReason: 'international_transaction_not_allowed',
    errorSource: 'business',
    errorStep: 'payment_initiation',
    errorDescription: 'This business accepts domestic cards only.',
    cardNetwork: 'Visa',
  });

const authorized = (id: string, at: string) =>
  event({ eventType: 'payment.authorized', razorpayPaymentId: id, eventAt: new Date(at) });

const captured = (id: string, at: string) =>
  event({ eventType: 'payment.captured', razorpayPaymentId: id, eventAt: new Date(at) });

const orderPaid = (id: string, at: string) =>
  event({ eventType: 'order.paid', razorpayPaymentId: id, eventAt: new Date(at) });

/** Every ordering of a list. Small inputs only — this is factorial. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('resolveAttempt', () => {
  it('resolves a clean capture', () => {
    const attempt = resolveAttempt([
      authorized('pay_A', '2026-01-01T00:00:00Z'),
      captured('pay_A', '2026-01-01T00:00:05Z'),
    ]);

    expect(attempt?.status).toBe('captured');
    expect(attempt?.failure).toBeNull();
    expect(attempt?.eventCount).toBe(2);
  });

  it('resolves a decline', () => {
    const attempt = resolveAttempt([failed('pay_A', '2026-01-01T00:00:00Z')]);

    expect(attempt?.status).toBe('failed');
    expect(attempt?.failure?.reason).toBe('international_transaction_not_allowed');
    expect(attempt?.failure?.step).toBe('payment_initiation');
  });

  it('treats failed followed by captured as captured, not as a contradiction', () => {
    // A UPI late confirmation genuinely does this. Reporting it as an error would turn a
    // recovery into a second incident.
    const attempt = resolveAttempt([
      failed('pay_A', '2026-01-01T00:00:00Z'),
      captured('pay_A', '2026-01-01T00:01:00Z'),
    ]);

    expect(attempt?.status).toBe('captured');
  });

  it('keeps the failure on the record even once the attempt succeeded', () => {
    // A recovery is only legible if the thing it recovered from is still visible.
    const attempt = resolveAttempt([
      failed('pay_A', '2026-01-01T00:00:00Z'),
      captured('pay_A', '2026-01-01T00:01:00Z'),
    ]);

    expect(attempt?.failure?.reason).toBe('international_transaction_not_allowed');
  });

  it('resolves identically under every ordering of the same events', () => {
    const events = [
      failed('pay_A', '2026-01-01T00:00:00Z'),
      authorized('pay_A', '2026-01-01T00:01:00Z'),
      captured('pay_A', '2026-01-01T00:02:00Z'),
      orderPaid('pay_A', '2026-01-01T00:02:01Z'),
    ];

    const results = permutations(events).map((ordering) =>
      JSON.stringify(resolveAttempt(ordering)),
    );
    expect(new Set(results).size).toBe(1);
    expect(results).toHaveLength(24);
  });

  it('is unchanged by duplicate deliveries', () => {
    const one = [
      authorized('pay_A', '2026-01-01T00:00:00Z'),
      captured('pay_A', '2026-01-01T00:00:05Z'),
    ];
    const withRepeats = [one[0]!, one[1]!, one[0]!, one[1]!, one[1]!];

    expect(resolveAttempt(withRepeats)?.status).toBe(resolveAttempt(one)?.status);
    // Only the count differs, which is the honest record of what arrived.
    expect(resolveAttempt(withRepeats)?.eventCount).toBe(5);
  });

  it('ignores an event type it has never seen rather than failing on it', () => {
    // All 41 Razorpay event types are enabled, most of which say nothing about a payment's
    // progress. An unknown one must not change the answer.
    const attempt = resolveAttempt([
      captured('pay_A', '2026-01-01T00:00:00Z'),
      event({ eventType: 'settlement.processed', eventAt: new Date('2026-01-02T00:00:00Z') }),
    ]);

    expect(attempt?.status).toBe('captured');
  });

  it('returns nothing for an empty set or for events naming no payment', () => {
    expect(resolveAttempt([])).toBeNull();
    expect(
      resolveAttempt([event({ eventType: 'order.paid', razorpayPaymentId: null })]),
    ).toBeNull();
  });

  it('records the span the attempt covers', () => {
    const attempt = resolveAttempt([
      captured('pay_A', '2026-01-01T00:02:00Z'),
      failed('pay_A', '2026-01-01T00:00:00Z'),
    ]);

    expect(attempt?.firstSeenAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(attempt?.lastSeenAt.toISOString()).toBe('2026-01-01T00:02:00.000Z');
  });

  it('marks the attempt late when any contributing event was late', () => {
    const attempt = resolveAttempt([
      captured('pay_A', '2026-01-01T00:00:00Z'),
      { ...failed('pay_A', '2026-01-01T00:00:01Z'), late: true },
    ]);

    expect(attempt?.late).toBe(true);
  });
});

describe('resolveOrder', () => {
  /** The real sequence from the deployed instance: a declined card, then a successful retry. */
  const recovery = [
    failed('pay_TTyzcANZB9mSVn', '2026-08-25T11:16:09Z'),
    authorized('pay_TTz2PHRSa5mdZp', '2026-08-25T11:18:56Z'),
    captured('pay_TTz2PHRSa5mdZp', '2026-08-25T11:18:57Z'),
    orderPaid('pay_TTz2PHRSa5mdZp', '2026-08-25T11:18:57Z'),
  ];

  it('separates two payments on one order into two attempts', () => {
    const order = resolveOrder('order_TTyyheY7fRMZnW', recovery);

    expect(order?.attempts).toHaveLength(2);
    expect(order?.attempts[0]?.status).toBe('failed');
    expect(order?.attempts[1]?.status).toBe('captured');
  });

  it('reports a decline followed by a successful retry as recovered', () => {
    const order = resolveOrder('order_TTyyheY7fRMZnW', recovery);

    expect(order?.outcome).toBe('paid');
    expect(order?.recovered).toBe(true);
    expect(order?.failureCount).toBe(1);
  });

  it('does not call a first-time success a recovery', () => {
    const order = resolveOrder('order_1', [
      authorized('pay_A', '2026-01-01T00:00:00Z'),
      captured('pay_A', '2026-01-01T00:00:05Z'),
    ]);

    expect(order?.outcome).toBe('paid');
    expect(order?.recovered).toBe(false);
  });

  it('reports an order whose every attempt failed as failed', () => {
    const order = resolveOrder('order_1', [
      failed('pay_A', '2026-01-01T00:00:00Z'),
      failed('pay_B', '2026-01-01T00:00:30Z'),
      failed('pay_C', '2026-01-01T00:01:00Z'),
    ]);

    expect(order?.outcome).toBe('failed');
    expect(order?.recovered).toBe(false);
    expect(order?.failureCount).toBe(3);
  });

  it('reports an authorised but uncaptured order as pending', () => {
    const order = resolveOrder('order_1', [authorized('pay_A', '2026-01-01T00:00:00Z')]);

    expect(order?.outcome).toBe('pending');
  });

  it('resolves identically under every ordering of the same events', () => {
    // The slice's exit gate, on the real sequence rather than an invented one.
    const results = permutations(recovery).map((ordering) =>
      JSON.stringify(resolveOrder('order_TTyyheY7fRMZnW', ordering)),
    );

    expect(new Set(results).size).toBe(1);
    expect(results).toHaveLength(24);
  });

  it('orders attempts by when the shopper made them', () => {
    const order = resolveOrder('order_TTyyheY7fRMZnW', [...recovery].reverse());

    expect(order?.attempts.map((a) => a.razorpayPaymentId)).toEqual([
      'pay_TTyzcANZB9mSVn',
      'pay_TTz2PHRSa5mdZp',
    ]);
  });

  it('returns nothing when no event names a payment', () => {
    expect(
      resolveOrder('order_1', [event({ eventType: 'order.paid', razorpayPaymentId: null })]),
    ).toBeNull();
  });
});
