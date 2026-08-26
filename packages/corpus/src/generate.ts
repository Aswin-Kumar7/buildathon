import { createHash } from 'node:crypto';
import { Draw } from './random.js';
import {
  DECLINE_REASONS,
  SCENARIOS,
  type Classification,
  type DeclineKind,
  type ScenarioFamily,
  type ScenarioSpec,
} from './spec.js';

/**
 * The checkout context the storefront would have recorded, before any pseudonymisation.
 *
 * These are the correlation keys Razorpay's webhooks cannot carry, and the reason the
 * distributed attack is detectable at all. The replayer hashes them through the same code the
 * real storefront uses, so a replayed scenario is indistinguishable from live traffic in
 * everything except the flag saying it is not.
 */
export interface GeneratedCheckout {
  razorpayOrderId: string;
  clientSessionId: string;
  deviceId: string;
  ip: string;
  userAgentFamily: string;
  amountPaise: number;
  itemCount: number;
  createdAt: string;
}

/** A Razorpay-shaped webhook body. Deliberately missing every customer-associated field. */
export interface GeneratedEvent {
  razorpayEventId: string;
  body: Record<string, unknown>;
}

export interface GeneratedScenario {
  family: ScenarioFamily;
  seed: number;
  /** Of the spec that produced this. A changed parameter changes this, visibly. */
  specHash: string;
  generatedFrom: ScenarioSpec;
  labels: {
    classification: Classification;
    correlation: string;
    recommendedAction: string;
  };
  startedAt: string;
  endedAt: string;
  checkouts: GeneratedCheckout[];
  events: GeneratedEvent[];
  counts: {
    orders: number;
    events: number;
    captured: number;
    failed: number;
    distinctSessions: number;
    distinctNetworks: number;
  };
}

/** Fixed so a scenario is reproducible; nothing here depends on when it was generated. */
const EPOCH = Date.parse('2026-03-01T09:00:00.000Z');

const UA_FAMILIES = ['chrome', 'safari', 'firefox', 'edge', 'android', 'ios'] as const;

export function specHash(spec: ScenarioSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);
}

/**
 * A synthetic network address in the documentation range.
 *
 * 198.51.100.0/24 is reserved by RFC 5737 for exactly this and is not routable, so a fixture
 * that escapes into something that tries to contact it reaches nothing.
 */
function syntheticIp(draw: Draw, index: number): string {
  return `198.51.100.${(index % 254) + 1}`;
}

interface Decline {
  reason: string;
  step: string;
  source: string;
}

/**
 * Widened before picking. `as const` makes each list a readonly tuple of distinct literal
 * types, and a union of tuples has no single element type for `pick` to infer.
 */
function declineFor(draw: Draw, kind: DeclineKind): Decline {
  return draw.pick(DECLINE_REASONS[kind] as readonly Decline[]);
}

/**
 * Which decline vocabulary a family draws from.
 *
 * An outage produces gateway errors; enumeration produces card-validity and authentication
 * failures. A corpus where every failure has the same reason would let a detector look good
 * while ignoring the field that actually separates the cases.
 */
const DECLINE_KIND: Record<ScenarioFamily, DeclineKind> = {
  normal_traffic: 'bank',
  customer_error: 'customer',
  gateway_outage: 'gateway',
  retry_storm: 'bank',
  flash_sale: 'bank',
  attack_loud: 'enumeration',
  attack_low_amplitude: 'enumeration',
  attack_distributed: 'enumeration',
};

function paymentEntity(input: {
  paymentId: string;
  orderId: string;
  amountPaise: number;
  status: 'authorized' | 'captured' | 'failed';
  method: string;
  cardId: string | null;
  at: number;
  decline: Decline | null;
}): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    id: input.paymentId,
    entity: 'payment',
    amount: input.amountPaise,
    currency: 'INR',
    status: input.status,
    order_id: input.orderId,
    method: input.method,
    captured: input.status === 'captured',
    created_at: Math.floor(input.at / 1000),
  };

  // Coarse card cohort only, and no last four — for a tokenised card that is the token's, not
  // the card's, so it identifies a person while not even being the signal it looks like.
  if (input.cardId !== null) {
    entity['card_id'] = input.cardId;
    entity['card'] = {
      id: input.cardId,
      entity: 'card',
      network: 'Visa',
      type: 'credit',
      issuer: 'SIMB',
      international: false,
    };
  }

  if (input.decline !== null) {
    entity['error_code'] = 'BAD_REQUEST_ERROR';
    entity['error_reason'] = input.decline.reason;
    entity['error_step'] = input.decline.step;
    entity['error_source'] = input.decline.source;
    entity['error_description'] = 'Simulated decline from the scenario corpus.';
  }

  return entity;
}

function webhookBody(event: string, at: number, payload: Record<string, unknown>) {
  return {
    entity: 'event',
    account_id: 'acc_SIMULATED',
    event,
    contains: Object.keys(payload),
    created_at: Math.floor(at / 1000),
    payload,
  };
}

interface OrderContext {
  orderId: string;
  amountPaise: number;
  cardId: string;
  at: number;
}

/**
 * A payment that went through: authorised, captured, and the order marked paid.
 *
 * `captureOnly` covers a retry after a decline, where Razorpay has already authorised on an
 * earlier attempt — emitting a second authorisation there would invent an event the real
 * gateway does not send.
 */
function capturedEvents(draw: Draw, order: OrderContext, captureOnly = false): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const shared = {
    paymentId: draw.id('pay'),
    orderId: order.orderId,
    amountPaise: order.amountPaise,
    method: 'card',
    cardId: order.cardId,
    decline: null,
  };
  let at = order.at;

  if (!captureOnly) {
    events.push({
      razorpayEventId: draw.id('evt'),
      body: webhookBody('payment.authorized', at, {
        payment: { entity: paymentEntity({ ...shared, status: 'authorized', at }) },
      }),
    });
    at += draw.int(500, 4_000);
  }

  events.push({
    razorpayEventId: draw.id('evt'),
    body: webhookBody('payment.captured', at, {
      payment: { entity: paymentEntity({ ...shared, status: 'captured', at }) },
    }),
  });

  if (captureOnly) return events;

  at += draw.int(200, 1_500);
  events.push({
    razorpayEventId: draw.id('evt'),
    body: webhookBody('order.paid', at, {
      order: {
        entity: {
          id: order.orderId,
          entity: 'order',
          amount: order.amountPaise,
          amount_paid: order.amountPaise,
          currency: 'INR',
          status: 'paid',
          created_at: Math.floor(at / 1000),
        },
      },
      payment: { entity: paymentEntity({ ...shared, status: 'captured', at }) },
    }),
  });

  return events;
}

/** One or more declines on the same order, each a distinct payment. */
function declinedEvents(
  draw: Draw,
  order: OrderContext,
  kind: DeclineKind,
  retries: number,
): { events: GeneratedEvent[]; endedAt: number } {
  const events: GeneratedEvent[] = [];
  let at = order.at;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    at += draw.int(3_000, 45_000);
    events.push({
      razorpayEventId: draw.id('evt'),
      body: webhookBody('payment.failed', at, {
        payment: {
          entity: paymentEntity({
            paymentId: draw.id('pay'),
            orderId: order.orderId,
            amountPaise: order.amountPaise,
            status: 'failed',
            method: 'card',
            cardId: order.cardId,
            at,
            decline: declineFor(draw, kind),
          }),
        },
      }),
    });
  }

  return { events, endedAt: at };
}

/**
 * Produces one scenario from its committed specification and seed.
 *
 * Deterministic: the same family and seed give the same events, every time, on any machine.
 * Nothing reads the clock, and every random draw comes from the seeded generator.
 */
/**
 * Draws the shape of one run from the declared ranges.
 *
 * Every range is collapsed to a value here, in one place and in a fixed order, because the
 * seeded generator is a sequence: moving a draw changes every number after it. Keeping them
 * together makes that ordering visible rather than scattered through the loop below.
 */
function plan(spec: ScenarioSpec, draw: Draw) {
  const windowMinutes = draw.int(spec.windowMinutes[0], spec.windowMinutes[1]);
  const orderCount = draw.int(spec.orders[0], spec.orders[1]);
  const approval = draw.float(spec.approvalRate[0], spec.approvalRate[1]);

  // Capped at the order count: more sessions than orders would be a session that never
  // bought anything, which is not a thing the storefront can produce.
  const sessionCount = Math.min(
    draw.int(spec.distinctSessions[0], spec.distinctSessions[1]),
    orderCount,
  );
  const networkCount = Math.min(
    draw.int(spec.distinctNetworks[0], spec.distinctNetworks[1]),
    orderCount,
  );

  return {
    orderCount,
    approval,
    meanGap: (windowMinutes * 60) / orderCount,
    sessions: Array.from({ length: sessionCount }, () => ({
      clientSessionId: draw.id('sess', 20),
      deviceId: draw.id('dev', 20),
      userAgentFamily: draw.pick(UA_FAMILIES),
    })),
    networks: Array.from({ length: networkCount }, (_, index) => syntheticIp(draw, index)),
  };
}

/**
 * Adjustments a caller can make to a family's declared ranges, to synthesise a boundary case the
 * eight committed families do not cover.
 *
 * The committed families are each cleanly separable — an attack shares no region of feature space
 * with anything benign — which is exactly what makes a model that aces them prove nothing. Real
 * traffic is not that tidy: a tester validating a small pool of stolen cards looks like a biller's
 * dunning on the card-spread axis, and a big renewal batch across many cards looks like enumeration
 * on it. These overrides let the *training exporter* build those overlaps deliberately, from the
 * same generator, without disturbing the committed families — which pass no overrides and are
 * therefore reproduced byte for byte, so every fixture and replay test still holds.
 */
export interface ScenarioOverrides {
  windowMinutes?: [number, number];
  orders?: [number, number];
  approvalRate?: [number, number];
  distinctSessions?: [number, number];
  distinctNetworks?: [number, number];
  amountPaise?: [number, number];
  /**
   * Draw each order's card from a fixed pool of this many cards, instead of a fresh card per order.
   * A small pool is card reuse (dunning-shaped); a large one is wide card spread (enumeration-shaped)
   * — the single axis that most cleanly separates the two, made ambiguous on purpose.
   */
  cardPoolSize?: number;
}

/**
 * A family's declared spec, with the overridable ranges replaced. With no overrides it returns the
 * committed spec unchanged — same object, same values — so `plan` draws exactly what it always did
 * and the eight committed families reproduce byte for byte.
 */
function effectiveSpec(family: ScenarioFamily, overrides?: ScenarioOverrides): ScenarioSpec {
  const base = SCENARIOS[family];
  if (overrides === undefined) return base;
  return {
    ...base,
    windowMinutes: overrides.windowMinutes ?? base.windowMinutes,
    orders: overrides.orders ?? base.orders,
    approvalRate: overrides.approvalRate ?? base.approvalRate,
    distinctSessions: overrides.distinctSessions ?? base.distinctSessions,
    distinctNetworks: overrides.distinctNetworks ?? base.distinctNetworks,
    amountPaise: overrides.amountPaise ?? base.amountPaise,
  };
}

/**
 * How each order's card is chosen, resolved once before the loop.
 *
 * A fixed pool (drawn up front, when requested) is reuse; a retry storm reuses its committed handful;
 * otherwise every order gets a fresh card. Each branch returns a closure invoked at the same point in
 * the loop as the original inline draw, so the committed families' draw sequences are untouched.
 */
function cardSelector(
  family: ScenarioFamily,
  draw: Draw,
  cardPoolSize?: number,
): (index: number) => string {
  if (cardPoolSize !== undefined && cardPoolSize > 0) {
    const pool = Array.from({ length: cardPoolSize }, () => draw.id('card', 12));
    return (index) => pool[index % pool.length]!;
  }
  if (family === 'retry_storm') {
    return (index) => `card_SIMDUNNING${String(index % 8).padStart(2, '0')}`;
  }
  return () => draw.id('card', 12);
}

export function generate(
  family: ScenarioFamily,
  seedOverride?: number,
  overrides?: ScenarioOverrides,
): GeneratedScenario {
  const spec = effectiveSpec(family, overrides);
  const seed = seedOverride ?? spec.seed;
  const draw = new Draw(seed);

  const { orderCount, approval, meanGap, sessions, networks } = plan(spec, draw);

  // Resolved here, at the same point the pool was previously drawn, so the committed families' draw
  // sequences are unchanged.
  const nextCard = cardSelector(family, draw, overrides?.cardPoolSize);

  const checkouts: GeneratedCheckout[] = [];
  const events: GeneratedEvent[] = [];

  let cursor = EPOCH;
  let captured = 0;
  let failed = 0;

  for (let index = 0; index < orderCount; index += 1) {
    cursor += Math.round(draw.gapSeconds(meanGap) * 1000);

    const session = sessions[index % sessions.length]!;
    const ip = networks[index % networks.length]!;
    const orderId = draw.id('order');
    const amountPaise = draw.int(spec.amountPaise[0], spec.amountPaise[1]);

    checkouts.push({
      razorpayOrderId: orderId,
      clientSessionId: session.clientSessionId,
      deviceId: session.deviceId,
      ip,
      userAgentFamily: session.userAgentFamily,
      amountPaise,
      itemCount: draw.int(1, 4),
      createdAt: new Date(cursor).toISOString(),
    });

    const cardId = nextCard(index);

    const at = cursor + draw.int(2_000, 25_000);
    const order: OrderContext = { orderId, amountPaise, cardId, at };

    if (draw.bool(approval)) {
      captured += 1;
      events.push(...capturedEvents(draw, order));
      continue;
    }

    // A mistyped card is one or two declines and then a payment. Modelling the recovery is
    // the point of that family: it is the shape a naive failure counter cannot survive.
    const retries = family === 'customer_error' ? draw.int(1, 3) : 1;
    const declines = declinedEvents(draw, order, DECLINE_KIND[family], retries);
    failed += retries;
    events.push(...declines.events);

    if (family === 'customer_error') {
      captured += 1;
      events.push(
        ...capturedEvents(draw, { ...order, at: declines.endedAt + draw.int(5_000, 60_000) }, true),
      );
    }
  }

  return {
    family,
    seed,
    specHash: specHash(spec),
    generatedFrom: spec,
    labels: {
      classification: spec.classification,
      correlation: spec.correlation,
      recommendedAction: spec.recommendedAction,
    },
    startedAt: new Date(EPOCH).toISOString(),
    endedAt: new Date(cursor).toISOString(),
    checkouts,
    events,
    counts: {
      orders: orderCount,
      events: events.length,
      captured,
      failed,
      distinctSessions: sessions.length,
      distinctNetworks: networks.length,
    },
  };
}
