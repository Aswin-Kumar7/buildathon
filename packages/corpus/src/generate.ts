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
function syntheticIp(draw: Draw, index: number, realistic: boolean): string {
  // Realistic runs spread networks across many /24 subnets, the way unrelated shoppers on different
  // ISPs actually are — otherwise every synthetic IP truncates to one subnet and all traffic reads
  // as a single network. The committed default keeps its fixed documentation range and draws
  // nothing, so its bytes are unchanged.
  if (realistic) {
    return `${draw.int(1, 223)}.${draw.int(0, 255)}.${draw.int(0, 255)}.${(index % 254) + 1}`;
  }
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
  attack_carding: 'enumeration',
  attack_proxy: 'enumeration',
  attack_partial: 'enumeration',
};

/** The payment rails a real Indian merchant actually sees. */
export type PaymentRail = 'upi' | 'card' | 'netbanking' | 'wallet';

/** The instrument chosen for one order: its rail and, for a card, the network/type/issuer. */
interface ChosenMethod {
  rail: PaymentRail;
  network: string | null;
  cardType: string | null;
  /** Issuing bank for a card; the app/bank/wallet name for the other rails. */
  issuer: string | null;
}

/**
 * Rail mix per family, as shares of traffic — not detector thresholds.
 *
 * UPI is the majority rail in ordinary Indian retail; enumeration is a card-rail attack by nature
 * and subscription dunning runs on saved cards, so both skew hard to card. That skew is also what
 * makes an all-card burst legible against a UPI-dominant baseline — the realism and the signal are
 * the same fact. Only drawn when a caller asks for realistic methods; the committed families never
 * do, so their bytes are unchanged.
 */
const RAIL_MIX: Record<ScenarioFamily, readonly (readonly [PaymentRail, number])[]> = {
  normal_traffic: [
    ['upi', 62],
    ['card', 20],
    ['netbanking', 11],
    ['wallet', 7],
  ],
  customer_error: [
    ['upi', 50],
    ['card', 34],
    ['netbanking', 9],
    ['wallet', 7],
  ],
  gateway_outage: [
    ['upi', 60],
    ['card', 22],
    ['netbanking', 12],
    ['wallet', 6],
  ],
  flash_sale: [
    ['upi', 66],
    ['card', 18],
    ['netbanking', 10],
    ['wallet', 6],
  ],
  retry_storm: [
    ['card', 90],
    ['upi', 7],
    ['netbanking', 3],
  ],
  attack_loud: [['card', 100]],
  attack_low_amplitude: [['card', 100]],
  attack_distributed: [['card', 100]],
  attack_carding: [['card', 100]],
  attack_proxy: [['card', 100]],
  attack_partial: [['card', 100]],
};

const CARD_NETWORKS: readonly (readonly [string, number])[] = [
  ['Visa', 42],
  ['Mastercard', 28],
  ['RuPay', 25],
  ['Amex', 5],
];
const CARD_TYPES: readonly (readonly [string, number])[] = [
  ['debit', 62],
  ['credit', 38],
];
const ISSUERS = ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'IndusInd'] as const;
const UPI_APPS = ['GPay', 'PhonePe', 'Paytm', 'BHIM', 'CRED'] as const;
const BANKS = ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak'] as const;
const WALLETS = ['PhonePe', 'Paytm', 'Mobikwik', 'Amazon Pay'] as const;

/** The committed families' fixed card, so a run with no realistic-method request is unchanged. */
const DEFAULT_CARD_METHOD: ChosenMethod = {
  rail: 'card',
  network: 'Visa',
  cardType: 'credit',
  issuer: 'SIMB',
};

function weightedPick<T extends string>(draw: Draw, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let point = draw.float(0, total);
  for (const [value, weight] of options) {
    if (point < weight) return value;
    point -= weight;
  }
  return options[options.length - 1]![0];
}

/** A realistic instrument for one order. Drawn only when realistic methods are requested. */
function chooseMethod(draw: Draw, family: ScenarioFamily): ChosenMethod {
  const rail = weightedPick(draw, RAIL_MIX[family]);
  if (rail === 'card') {
    return {
      rail,
      network: weightedPick(draw, CARD_NETWORKS),
      cardType: weightedPick(draw, CARD_TYPES),
      issuer: draw.pick(ISSUERS),
    };
  }
  const label =
    rail === 'upi'
      ? draw.pick(UPI_APPS)
      : rail === 'netbanking'
        ? draw.pick(BANKS)
        : draw.pick(WALLETS);
  return { rail, network: null, cardType: null, issuer: label };
}

function paymentEntity(input: {
  paymentId: string;
  orderId: string;
  amountPaise: number;
  status: 'authorized' | 'captured' | 'failed';
  method: ChosenMethod;
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
    method: input.method.rail,
    captured: input.status === 'captured',
    created_at: Math.floor(input.at / 1000),
  };

  // The instrument block, shaped like the rail Razorpay actually reports. A card carries a coarse
  // cohort only — no last four, which for a tokenised card is the token's and not the card's — and
  // the other rails carry the app or bank name a merchant sees, never anything that identifies a
  // person. `card_id` exists solely as the correlation key card enumeration is caught on; the other
  // rails deliberately have none, so UPI-heavy ordinary traffic never reads as card spread.
  if (input.method.rail === 'card' && input.cardId !== null) {
    entity['card_id'] = input.cardId;
    entity['card'] = {
      id: input.cardId,
      entity: 'card',
      network: input.method.network,
      type: input.method.cardType,
      issuer: input.method.issuer,
      international: false,
    };
  } else if (input.method.rail === 'upi') {
    entity['upi'] = { payer_account_type: 'bank_account', app: input.method.issuer };
  } else if (input.method.rail === 'netbanking') {
    entity['bank'] = input.method.issuer;
  } else if (input.method.rail === 'wallet') {
    entity['wallet'] = input.method.issuer;
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
  cardId: string | null;
  method: ChosenMethod;
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
    method: order.method,
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
            method: order.method,
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
function plan(spec: ScenarioSpec, draw: Draw, realistic: boolean) {
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
    networks: Array.from({ length: networkCount }, (_, index) =>
      syntheticIp(draw, index, realistic),
    ),
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
  /**
   * Spread payments across realistic rails (UPI/card/netbanking/wallet) instead of the committed
   * card-only default. Adds draws, so it deliberately changes the byte-for-byte output — used by the
   * live simulation, never by the committed families (which pass no overrides and are unchanged).
   */
  realisticMethods?: boolean;
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
  const realistic = overrides?.realisticMethods === true;

  const { orderCount, approval, meanGap, sessions, networks } = plan(spec, draw, realistic);

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

    // Realistic runs draw a rail per order (attacks and dunning stay card-heavy); the committed
    // default is the fixed card, and only a card order consumes a card id, so the OFF path is the
    // exact draw sequence it always was.
    const method = realistic ? chooseMethod(draw, family) : DEFAULT_CARD_METHOD;
    const cardId = method.rail === 'card' ? nextCard(index) : null;

    const at = cursor + draw.int(2_000, 25_000);
    const order: OrderContext = { orderId, amountPaise, cardId, method, at };

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
