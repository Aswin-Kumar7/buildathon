/**
 * Resolving payment attempts from event history.
 *
 * Pure: no database, no clock, no framework. Everything here is a function of its arguments,
 * which is what makes the order-independence property testable by permutation rather than
 * argued for in a comment.
 */

/** Razorpay's payment vocabulary, in the order a payment progresses through it. */
export const ATTEMPT_STATUSES = [
  'created',
  'failed',
  'authorized',
  'captured',
  'refunded',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * How far through its life an observed status places a payment.
 *
 * The resolved status is the highest rank in the event set — not the status of the last
 * event to arrive. That is the whole trick, and it is what makes the result independent of
 * delivery order: `max` over a set does not care how the set was assembled, so duplicates,
 * reordering and replays after a restart all land in the same place.
 *
 * `failed` ranks below `authorized` deliberately. A payment that failed and was later
 * captured resolves to captured, which is not a contradiction being papered over — it is
 * what a UPI late confirmation genuinely looks like, and treating it as an error would make
 * the system report a recovery as a second incident.
 */
const RANK: Record<AttemptStatus, number> = {
  created: 0,
  failed: 1,
  authorized: 2,
  captured: 3,
  refunded: 4,
};

/** What each event type says about the payment it names. */
const EVENT_STATUS: Record<string, AttemptStatus> = {
  'payment.authorized': 'authorized',
  'payment.captured': 'captured',
  'payment.failed': 'failed',
  'order.paid': 'captured',
  'refund.created': 'refunded',
  'refund.processed': 'refunded',
  'refund.speed_changed': 'refunded',
};

export interface AttemptEvent {
  eventType: string;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  status: string | null;
  method: string | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorDescription: string | null;
  cardNetwork: string | null;
  cardIssuer: string | null;
  amountPaise: number | null;
  eventAt: Date;
  late: boolean;
}

export interface ResolvedAttempt {
  razorpayPaymentId: string;
  razorpayOrderId: string | null;
  status: AttemptStatus;
  amountPaise: number | null;
  method: string | null;
  cardNetwork: string | null;
  cardIssuer: string | null;

  /** Present when this attempt was ever seen to fail, whatever it resolved to. */
  failure: {
    code: string | null;
    reason: string | null;
    source: string | null;
    step: string | null;
    description: string | null;
  } | null;

  firstSeenAt: Date;
  lastSeenAt: Date;
  eventCount: number;
  /** True when any contributing event arrived beyond the allowed-lateness bound. */
  late: boolean;
}

/**
 * Picks the value carried by the highest-ranked event that has one.
 *
 * Ties break on event time, then on event type, so two events of equal rank cannot produce a
 * different answer depending on which arrived first.
 */
function pick<T>(
  events: readonly AttemptEvent[],
  read: (event: AttemptEvent) => T | null,
): T | null {
  const candidates = events
    .filter((event) => read(event) !== null)
    .sort(
      (a, b) =>
        rankOf(b) - rankOf(a) ||
        b.eventAt.getTime() - a.eventAt.getTime() ||
        b.eventType.localeCompare(a.eventType),
    );

  return candidates.length > 0 ? read(candidates[0]!) : null;
}

function rankOf(event: AttemptEvent): number {
  const status = EVENT_STATUS[event.eventType];
  return status === undefined ? -1 : RANK[status];
}

/**
 * Collapses every event naming one payment into a single resolved attempt.
 *
 * Given the same set of events in any order, with any duplicates, this returns the same
 * value — the property the whole slice exists to guarantee, and the reason a replay after a
 * crash cannot produce a different history than the original run did.
 */
export function resolveAttempt(events: readonly AttemptEvent[]): ResolvedAttempt | null {
  const paymentId = events.find((event) => event.razorpayPaymentId !== null)?.razorpayPaymentId;
  if (events.length === 0 || paymentId === undefined || paymentId === null) return null;

  const status = events.reduce<AttemptStatus>((best, event) => {
    const observed = EVENT_STATUS[event.eventType];
    if (observed === undefined) return best;
    return RANK[observed] > RANK[best] ? observed : best;
  }, 'created');

  // Kept even when the attempt resolved to captured. A recovery is only legible if the thing
  // it recovered from is still on the record.
  const failed = events.filter((event) => EVENT_STATUS[event.eventType] === 'failed');
  const failure =
    failed.length === 0
      ? null
      : {
          code: pick(failed, (e) => e.errorCode),
          reason: pick(failed, (e) => e.errorReason),
          source: pick(failed, (e) => e.errorSource),
          step: pick(failed, (e) => e.errorStep),
          description: pick(failed, (e) => e.errorDescription),
        };

  const times = events.map((event) => event.eventAt.getTime());

  return {
    razorpayPaymentId: paymentId,
    razorpayOrderId: pick(events, (e) => e.razorpayOrderId),
    status,
    amountPaise: pick(events, (e) => e.amountPaise),
    method: pick(events, (e) => e.method),
    cardNetwork: pick(events, (e) => e.cardNetwork),
    cardIssuer: pick(events, (e) => e.cardIssuer),
    failure,
    firstSeenAt: new Date(Math.min(...times)),
    lastSeenAt: new Date(Math.max(...times)),
    eventCount: events.length,
    late: events.some((event) => event.late),
  };
}

export type OrderOutcome = 'paid' | 'failed' | 'pending';

export interface ResolvedOrder {
  razorpayOrderId: string;
  outcome: OrderOutcome;
  /**
   * A failure happened and the order was paid anyway.
   *
   * This is the field the console is built around. A shopper whose card was declined and who
   * then paid by UPI is a customer who had a bad minute, not an attacker — and an order that
   * shows two failures and no recovery is the opposite. Collapsing both into "two failed
   * payments" is how a detector ends up accusing people of card testing for having a bank
   * that was briefly down.
   */
  recovered: boolean;
  attempts: ResolvedAttempt[];
  amountPaise: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  failureCount: number;
}

/**
 * Groups events by payment and resolves the order they belong to.
 *
 * An order is not a payment. A shopper who is declined and retries produces two payments
 * under one order, and the recovery only exists at this level — no single attempt can see it.
 */
export function resolveOrder(
  razorpayOrderId: string,
  events: readonly AttemptEvent[],
): ResolvedOrder | null {
  const byPayment = new Map<string, AttemptEvent[]>();
  for (const event of events) {
    if (event.razorpayPaymentId === null) continue;
    const existing = byPayment.get(event.razorpayPaymentId);
    if (existing === undefined) byPayment.set(event.razorpayPaymentId, [event]);
    else existing.push(event);
  }

  const attempts = [...byPayment.values()]
    .map((group) => resolveAttempt(group))
    .filter((attempt): attempt is ResolvedAttempt => attempt !== null)
    // Sorted by when each attempt was first seen, so the timeline reads in the order the
    // shopper lived it rather than in whatever order the events were stored.
    .sort(
      (a, b) =>
        a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
        a.razorpayPaymentId.localeCompare(b.razorpayPaymentId),
    );

  if (attempts.length === 0) return null;

  const settled = attempts.some(
    (attempt) => attempt.status === 'captured' || attempt.status === 'refunded',
  );
  const failureCount = attempts.filter((attempt) => attempt.failure !== null).length;
  const allFailed = attempts.every((attempt) => attempt.status === 'failed');

  const times = attempts.flatMap((a) => [a.firstSeenAt.getTime(), a.lastSeenAt.getTime()]);

  return {
    razorpayOrderId,
    outcome: settled ? 'paid' : allFailed ? 'failed' : 'pending',
    recovered: settled && failureCount > 0,
    attempts,
    amountPaise: attempts.find((a) => a.amountPaise !== null)?.amountPaise ?? null,
    firstSeenAt: new Date(Math.min(...times)),
    lastSeenAt: new Date(Math.max(...times)),
    failureCount,
  };
}
