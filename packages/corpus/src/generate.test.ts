import { describe, expect, it } from 'vitest';
import { generate, specHash } from './generate.js';
import { SCENARIOS, SCENARIO_FAMILIES } from './spec.js';

/** Field names that must never appear anywhere in a committed fixture. */
const FORBIDDEN = ['email', 'contact', 'last4', 'vpa', 'customer_id', 'bank_transaction_id'];

describe('determinism', () => {
  it('produces byte-identical output for the same family and seed', () => {
    // The property the whole corpus rests on. Without it, a pre-registered specification says
    // nothing, because nobody could check that the numbers came from it.
    for (const family of SCENARIO_FAMILIES) {
      expect(JSON.stringify(generate(family))).toBe(JSON.stringify(generate(family)));
    }
  });

  it('produces different output for a different seed', () => {
    expect(JSON.stringify(generate('normal_traffic', 1))).not.toBe(
      JSON.stringify(generate('normal_traffic', 2)),
    );
  });

  it('does not read the clock', () => {
    // A generator that used Date.now would drift between the fixture and any regeneration of
    // it, and the diff would be unreadable noise rather than a real change.
    const scenario = generate('normal_traffic');
    expect(scenario.startedAt).toBe('2026-03-01T09:00:00.000Z');
  });

  it('changes the spec hash when a parameter changes', () => {
    const original = SCENARIOS.attack_loud;
    const widened = { ...original, approvalRate: [0.01, 0.5] as [number, number] };

    expect(specHash(widened)).not.toBe(specHash(original));
  });
});

describe('confidentiality', () => {
  it('emits no customer-associated field in any family', () => {
    for (const family of SCENARIO_FAMILIES) {
      const serialised = JSON.stringify(generate(family));
      for (const field of FORBIDDEN) {
        expect(serialised, `${family} leaked ${field}`).not.toContain(`"${field}"`);
      }
    }
  });

  it('emits nothing shaped like a card number, an email or a phone number', () => {
    for (const family of SCENARIO_FAMILIES) {
      const serialised = JSON.stringify(generate(family));
      expect(serialised).not.toMatch(/\b(?:\d[ -]?){13,19}\b/);
      expect(serialised).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
      expect(serialised).not.toMatch(/\+91\d{10}/);
    }
  });

  it('uses identifiers that cannot be mistaken for real ones', () => {
    const scenario = generate('attack_loud');
    expect(scenario.checkouts[0]?.razorpayOrderId).toMatch(/^order_SIM/);
    expect(scenario.checkouts.every((c) => c.ip.startsWith('198.51.100.'))).toBe(true);
  });
});

describe('the families are actually different', () => {
  const all = Object.fromEntries(SCENARIO_FAMILIES.map((f) => [f, generate(f)]));

  it('gives every family a classification, a correlation and a recommended action', () => {
    // Not a length check. "Nothing." is the right answer for benign traffic, and a corpus
    // that padded it to satisfy a minimum would be worse than one that says so plainly.
    for (const family of SCENARIO_FAMILIES) {
      const labels = all[family]!.labels;
      expect(['benign', 'operational', 'attack']).toContain(labels.classification);
      expect(labels.recommendedAction.trim()).not.toBe('');
      expect(labels.correlation.trim()).not.toBe('');
    }
  });

  it('labels only the three attack families as attacks', () => {
    const attacks = SCENARIO_FAMILIES.filter((f) => all[f]!.labels.classification === 'attack');
    expect(attacks.sort()).toEqual(['attack_distributed', 'attack_loud', 'attack_low_amplitude']);
  });

  it('keeps an outage and a retry storm out of the attack class', () => {
    // Both produce more failures than some attacks. Classifying either as an attack is the
    // expensive mistake: one blocks customers for the acquirer being down, the other stops a
    // merchant collecting money it is owed.
    expect(all.gateway_outage!.labels.classification).toBe('operational');
    expect(all.retry_storm!.labels.classification).toBe('operational');
  });

  it('concentrates a loud attack in one session and one network', () => {
    expect(all.attack_loud!.counts.distinctSessions).toBe(1);
    expect(all.attack_loud!.counts.distinctNetworks).toBe(1);
  });

  it('spreads a distributed attack across many networks', () => {
    // The point of the family: any per-network threshold is defeated by construction.
    expect(all.attack_distributed!.counts.distinctNetworks).toBeGreaterThan(15);
  });

  it('spreads an outage across unrelated shoppers, unlike an attack', () => {
    // The distinction that decides whether the right answer is "block" or "tell somebody the
    // gateway is unwell", and the two look identical if you only count failures.
    const outage = all.gateway_outage!;
    expect(outage.counts.distinctSessions).toBeGreaterThan(30);
    expect(outage.counts.failed).toBeGreaterThan(10);
  });

  it('inverts the card-to-attempt ratio for dunning against enumeration', () => {
    // Dunning: few cards, many attempts. Enumeration: many cards, few attempts. A detector
    // keyed on raw failure volume cannot tell them apart at all.
    const dunningCards = new Set(
      JSON.stringify(all.retry_storm).match(/card_SIMDUNNING\d{2}/g) ?? [],
    );
    expect(dunningCards.size).toBeLessThanOrEqual(8);
    expect(all.retry_storm!.counts.failed).toBeGreaterThan(dunningCards.size * 2);
  });

  it('keeps a flash sale at a normal failure rate despite a high failure count', () => {
    // Any threshold expressed as failures per minute fires here. Only a rate survives it.
    const sale = all.flash_sale!;
    const rate = sale.counts.failed / (sale.counts.captured + sale.counts.failed);
    expect(sale.counts.failed).toBeGreaterThan(5);
    expect(rate).toBeLessThan(0.2);
  });

  it('gives attacks an approval rate no honest traffic reaches', () => {
    for (const family of ['attack_loud', 'attack_low_amplitude', 'attack_distributed'] as const) {
      const s = all[family]!;
      const approval = s.counts.captured / (s.counts.captured + s.counts.failed);
      expect(approval, family).toBeLessThan(0.15);
    }

    const normal = all.normal_traffic!;
    expect(
      normal.counts.captured / (normal.counts.captured + normal.counts.failed),
    ).toBeGreaterThan(0.8);
  });

  it('ends every customer error in a payment', () => {
    // Which is exactly why counting failures without resolving state accuses paying customers.
    const errors = all.customer_error!;
    expect(errors.counts.failed).toBeGreaterThan(0);
    expect(errors.counts.captured).toBeGreaterThanOrEqual(errors.counts.orders);
  });
});

describe('shape', () => {
  it('emits a checkout for every order', () => {
    for (const family of SCENARIO_FAMILIES) {
      const scenario = generate(family);
      expect(scenario.checkouts).toHaveLength(scenario.counts.orders);
    }
  });

  it('emits webhook bodies the ingestion path can read', () => {
    const scenario = generate('normal_traffic');
    const body = scenario.events[0]!.body as {
      event: string;
      payload: unknown;
      created_at: number;
    };

    expect(body.event).toMatch(/^(payment|order)\./);
    expect(body.created_at).toBeGreaterThan(1_700_000_000);
    expect(body.payload).toBeDefined();
  });

  it('gives every event a distinct id, so deduplication is not silently exercised', () => {
    for (const family of SCENARIO_FAMILIES) {
      const ids = generate(family).events.map((e) => e.razorpayEventId);
      expect(new Set(ids).size, family).toBe(ids.length);
    }
  });
});
