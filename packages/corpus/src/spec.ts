/**
 * The scenario definitions.
 *
 * Committed before any detector exists to be tuned against them. That ordering is the whole
 * point: a corpus written after the fact can be shaped, consciously or not, into one the
 * detector happens to do well on. These parameters are a claim made in advance, and the
 * seeds make each scenario reproducible byte for byte, so a later commit that quietly
 * widened a range to make a number look better would be visible in the diff.
 *
 * Attack parameters follow Visa's published guidance on enumeration and account testing
 * rather than being invented. Everything else is a declared range, because **no public
 * source publishes a per-merchant attempts-per-minute distribution** — anyone claiming a
 * precise figure for what normal looks like at an arbitrary merchant is guessing, and a
 * range that says so is more honest than a number that does not.
 */

export const SCENARIO_FAMILIES = [
  'normal_traffic',
  'customer_error',
  'gateway_outage',
  'retry_storm',
  'flash_sale',
  'attack_loud',
  'attack_low_amplitude',
  'attack_distributed',
  'attack_carding',
  'attack_proxy',
  'attack_partial',
] as const;

export type ScenarioFamily = (typeof SCENARIO_FAMILIES)[number];

/**
 * What the scenario is, operationally.
 *
 * `benign` and `operational` are both "not an attack", kept apart because the right response
 * differs: nothing at all versus tell somebody the gateway is unwell. Collapsing them is how
 * an outage gets treated as fraud.
 */
export type Classification = 'benign' | 'operational' | 'attack';

export interface ScenarioSpec {
  family: ScenarioFamily;
  title: string;
  /** What is happening in the world, in a sentence a non-engineer would accept. */
  narrative: string;
  classification: Classification;
  /** What actually ties these events together, and therefore what a detector must key on. */
  correlation: string;
  /** What should happen. Not what our detector does — what the right answer is. */
  recommendedAction: string;
  /** Why this scenario is hard, or why getting it wrong would be bad. */
  difficulty: string;
  seed: number;
  windowMinutes: [number, number];
  orders: [number, number];
  /** Share of attempts that succeed. A range, because a point estimate would be invented. */
  approvalRate: [number, number];
  distinctSessions: [number, number];
  distinctNetworks: [number, number];
  amountPaise: [number, number];
}

export const SCENARIOS: Record<ScenarioFamily, ScenarioSpec> = {
  normal_traffic: {
    family: 'normal_traffic',
    title: 'An ordinary hour',
    narrative: 'Shoppers arriving independently, most of them paying successfully first time.',
    classification: 'benign',
    correlation: 'None. Every order comes from a different session, device and network.',
    recommendedAction: 'Nothing.',
    difficulty:
      'The baseline everything else is measured against. A detector that fires here has no usable precision at any threshold.',
    seed: 1001,
    windowMinutes: [60, 90],
    orders: [40, 70],
    approvalRate: [0.88, 0.95],
    distinctSessions: [40, 70],
    distinctNetworks: [35, 65],
    amountPaise: [19_900, 449_700],
  },

  customer_error: {
    family: 'customer_error',
    title: 'People mistyping their cards',
    narrative:
      'A handful of shoppers get their expiry or CVV wrong, retry within a minute or two, and then pay.',
    classification: 'benign',
    correlation: 'One session, one card, two or three attempts, ending in a capture.',
    recommendedAction: 'Nothing. Every one of these is a paying customer.',
    difficulty:
      'Produces exactly the shape a naive failure counter looks for: repeated declines from one session. The recovery is the only thing separating it from an attack, which is why resolving state matters more than counting failures.',
    seed: 1002,
    windowMinutes: [60, 90],
    orders: [30, 55],
    approvalRate: [0.82, 0.9],
    distinctSessions: [30, 55],
    distinctNetworks: [28, 50],
    amountPaise: [19_900, 349_900],
  },

  gateway_outage: {
    family: 'gateway_outage',
    title: 'The acquirer falls over',
    narrative:
      'For a few minutes almost everything fails, across every shopper at once, and then recovers on its own.',
    classification: 'operational',
    correlation:
      'Time, and nothing else. Sessions, devices and networks are as unrelated as on a normal day.',
    recommendedAction:
      'Tell somebody the gateway is unwell. Blocking anything would punish customers for the acquirer being down.',
    difficulty:
      'The highest failure count of any scenario here, and the one where acting on it does the most harm. Distinguishable only by the failures being spread across unrelated shoppers rather than concentrated in one.',
    seed: 1003,
    windowMinutes: [45, 70],
    orders: [50, 90],
    approvalRate: [0.35, 0.55],
    distinctSessions: [50, 90],
    distinctNetworks: [45, 85],
    amountPaise: [19_900, 449_700],
  },

  retry_storm: {
    family: 'retry_storm',
    title: 'Legitimate dunning',
    narrative:
      'A subscription biller retrying failed renewals on a schedule, the same small set of cards over and over.',
    classification: 'operational',
    correlation:
      'A few cards, many attempts each, on a regular cadence. One merchant system, not one shopper.',
    recommendedAction:
      'Nothing, or a note to whoever owns the retry schedule. Blocking would stop the merchant collecting money it is owed.',
    difficulty:
      'Stripe warns that aggressive dunning looks exactly like card testing. The tell is inverted: an attack tries many cards a few times, dunning tries few cards many times. A detector keyed on raw failure volume cannot tell them apart at all.',
    seed: 1004,
    windowMinutes: [120, 180],
    orders: [40, 70],
    approvalRate: [0.08, 0.2],
    distinctSessions: [1, 3],
    distinctNetworks: [1, 2],
    amountPaise: [49_900, 99_900],
  },

  flash_sale: {
    family: 'flash_sale',
    title: 'A sale opening',
    narrative:
      'Five times the usual traffic in twenty minutes. The failure rate is normal; the failure count is not.',
    classification: 'benign',
    correlation: 'Time, and a shared interest in the same products. Otherwise unrelated shoppers.',
    recommendedAction: 'Nothing.',
    difficulty:
      'Any threshold expressed as failures per minute fires here. Only a rate, held against the volume it came from, survives it.',
    seed: 1005,
    windowMinutes: [20, 30],
    orders: [120, 200],
    approvalRate: [0.86, 0.93],
    distinctSessions: [120, 200],
    distinctNetworks: [110, 190],
    amountPaise: [19_900, 149_900],
  },

  attack_loud: {
    family: 'attack_loud',
    title: 'Card enumeration, undisguised',
    narrative:
      'One machine working through a list of card numbers as fast as the checkout allows, at trivial amounts.',
    classification: 'attack',
    correlation:
      'One session, one device, one network, many distinct cards, near-zero approval, minutes apart at most.',
    recommendedAction:
      'Contain it: challenge or block that session and network. The cost of being wrong is one inconvenienced shopper.',
    difficulty:
      'The easy case, and the one every detector claims. Included as a floor, not as evidence of anything.',
    seed: 1006,
    windowMinutes: [4, 10],
    orders: [50, 110],
    approvalRate: [0.01, 0.05],
    distinctSessions: [1, 1],
    distinctNetworks: [1, 1],
    amountPaise: [100, 2_000],
  },

  attack_low_amplitude: {
    family: 'attack_low_amplitude',
    title: 'Account testing, patient',
    narrative:
      'One or two attempts per card, spread over an hour, deliberately slow enough to stay under any fixed threshold.',
    classification: 'attack',
    correlation:
      'A small number of sessions, a large number of distinct cards, and an approval rate no honest traffic reaches.',
    recommendedAction: 'Contain it, but expect to need a longer window than a burst detector uses.',
    difficulty:
      'Never exceeds a per-minute threshold at any point. The signal is the approval rate and the card-to-session ratio, both of which need a window long enough to see them.',
    seed: 1007,
    windowMinutes: [45, 90],
    orders: [35, 70],
    approvalRate: [0.02, 0.07],
    distinctSessions: [2, 5],
    distinctNetworks: [2, 4],
    amountPaise: [100, 5_000],
  },

  attack_distributed: {
    family: 'attack_distributed',
    title: 'Enumeration behind many addresses',
    narrative:
      'The same operation spread across a proxy pool: two or three attempts from each of thirty networks.',
    classification: 'attack',
    correlation:
      'Not the network. Timing, amounts and client family are shared; the addresses are not.',
    recommendedAction:
      'Contain by the correlation that actually holds, which is not the network. Blocking addresses here blocks thirty innocent ones tomorrow.',
    difficulty:
      'Defeats every per-network threshold by construction. Whether anything catches it depends entirely on having a correlation key other than the address — which is exactly what the storefront sensor exists to provide.',
    seed: 1008,
    windowMinutes: [15, 30],
    orders: [45, 90],
    approvalRate: [0.02, 0.06],
    distinctSessions: [20, 40],
    distinctNetworks: [20, 40],
    amountPaise: [100, 3_000],
  },

  attack_carding: {
    family: 'attack_carding',
    title: 'Carding — buying with stolen cards',
    narrative:
      'An attacker putting a list of stolen cards through checkout at real prices, to buy goods rather than just prove the cards are live.',
    classification: 'attack',
    correlation:
      'One session, one device, one network; many distinct cards, almost none approved — the same enumeration shape at ordinary amounts.',
    recommendedAction:
      'Contain it. The loss here is real goods shipped against a stolen card, not one inconvenienced shopper.',
    difficulty:
      'Looks like ordinary purchasing on transaction size alone — the tell is the card-to-attempt spread and the near-zero approval, not the amount. A detector keyed on small-amount probing misses it.',
    seed: 1009,
    windowMinutes: [8, 18],
    orders: [50, 90],
    approvalRate: [0.02, 0.06],
    distinctSessions: [1, 1],
    distinctNetworks: [1, 1],
    amountPaise: [29_900, 179_900],
  },

  attack_proxy: {
    family: 'attack_proxy',
    title: 'Enumeration behind one proxy',
    narrative:
      'The same card-testing run spread across many short browser sessions that all exit through a single proxy or NAT, so no one session looks busy but the network does.',
    classification: 'attack',
    correlation:
      'Not the session — the network. Many small sessions, one shared address, many distinct cards across it.',
    recommendedAction:
      'Contain by network: the correlation that holds here is the shared address, not any one session.',
    difficulty:
      'Defeats a per-session threshold by construction — every session is too small on its own. Only a network-level view sees the spread, which is what separates it from a burst on one machine.',
    seed: 1010,
    windowMinutes: [10, 22],
    orders: [55, 95],
    approvalRate: [0.02, 0.06],
    distinctSessions: [18, 26],
    distinctNetworks: [1, 1],
    amountPaise: [100, 2_500],
  },

  attack_partial: {
    family: 'attack_partial',
    title: 'Testing a part-valid card list',
    narrative:
      'A card-testing run where a meaningful share of the cards still work — a fresher or partly-valid list — so approval is low but not on the floor.',
    classification: 'attack',
    correlation:
      'One session, many distinct cards, an approval rate below anything honest traffic reaches but above a dead list.',
    recommendedAction:
      'Review, then contain — the working cards make it live, but the higher approval leaves a shorter window of certainty.',
    difficulty:
      'Sits between enumeration and ordinary traffic on approval rate; the card spread is what still separates it, and it scores medium rather than high because fewer corroborating signals fire.',
    seed: 1011,
    windowMinutes: [10, 20],
    orders: [45, 80],
    approvalRate: [0.25, 0.4],
    distinctSessions: [1, 1],
    distinctNetworks: [1, 1],
    amountPaise: [19_900, 119_900],
  },
};

/**
 * Razorpay's own decline vocabulary, split by what the failure actually was.
 *
 * The mix matters: an enumeration run produces mostly authentication and card-validity
 * failures, whereas an outage produces gateway ones. A detector that ignores the reason and
 * counts only the failure is discarding the field that separates them.
 */
export const DECLINE_REASONS = {
  customer: [
    { reason: 'payment_failed', step: 'payment_authentication', source: 'customer' },
    { reason: 'invalid_cvv', step: 'payment_authentication', source: 'customer' },
    { reason: 'payment_cancelled', step: 'payment_authentication', source: 'customer' },
  ],
  bank: [
    { reason: 'payment_failed', step: 'payment_authorization', source: 'bank' },
    { reason: 'insufficient_funds', step: 'payment_authorization', source: 'bank' },
    { reason: 'card_declined', step: 'payment_authorization', source: 'bank' },
  ],
  gateway: [
    { reason: 'gateway_error', step: 'payment_authorization', source: 'gateway' },
    { reason: 'gateway_timeout', step: 'payment_authorization', source: 'gateway' },
  ],
  enumeration: [
    { reason: 'card_declined', step: 'payment_authorization', source: 'bank' },
    { reason: 'invalid_card', step: 'payment_initiation', source: 'bank' },
    { reason: 'payment_failed', step: 'payment_authentication', source: 'customer' },
  ],
} as const;

export type DeclineKind = keyof typeof DECLINE_REASONS;
