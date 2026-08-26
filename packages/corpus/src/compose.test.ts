import { describe, expect, it } from 'vitest';
import { mix } from './compose.js';
import { generate } from './generate.js';

describe('mix', () => {
  it('concatenates every part into one shop', () => {
    const bg = generate('normal_traffic', 1);
    const at = generate('attack_loud', 2);
    const merged = mix([
      { family: 'normal_traffic', seed: 1, role: 'background' },
      { family: 'attack_loud', seed: 2, role: 'attack' },
    ]);

    expect(merged.checkouts).toHaveLength(bg.checkouts.length + at.checkouts.length);
    expect(merged.events).toHaveLength(bg.events.length + at.events.length);
  });

  it('marks only the attack parts as abuse', () => {
    const merged = mix([
      { family: 'normal_traffic', seed: 10, role: 'background' },
      { family: 'attack_low_amplitude', seed: 11, role: 'attack' },
    ]);

    const attack = generate('attack_low_amplitude', 11);
    const background = generate('normal_traffic', 10);

    for (const checkout of attack.checkouts) {
      expect(merged.abuseSessionIds.has(checkout.clientSessionId)).toBe(true);
    }
    for (const checkout of background.checkouts) {
      expect(merged.abuseSessionIds.has(checkout.clientSessionId)).toBe(false);
    }
  });

  it('refuses parts that share a seed, which would collide their identifiers', () => {
    expect(() =>
      mix([
        { family: 'normal_traffic', seed: 4, role: 'background' },
        { family: 'attack_loud', seed: 4, role: 'attack' },
      ]),
    ).toThrow(/distinct seeds/);
  });

  it('is deterministic — the same parts give the same shop', () => {
    const parts = [
      { family: 'flash_sale', seed: 3, role: 'background' } as const,
      { family: 'attack_loud', seed: 8, role: 'attack' } as const,
    ];
    expect(JSON.stringify(mix(parts))).toBe(JSON.stringify(mix(parts)));
  });

  it('threads overrides to the embedded attack, so it can reuse a card pool', () => {
    const merged = mix([
      { family: 'normal_traffic', seed: 7, role: 'background' },
      { family: 'attack_loud', seed: 9, role: 'attack', overrides: { cardPoolSize: 6 } },
    ]);

    // The attack's checkouts belong to at most six distinct cards — the pool it was told to reuse.
    // Card ids live on the payment events, so count them there, restricted to the attack's orders.
    const attackOrders = new Set(
      generate('attack_loud', 9, { cardPoolSize: 6 }).checkouts.map((c) => c.razorpayOrderId),
    );
    const cards = new Set<string>();
    for (const event of merged.events) {
      const payload = event.body?.payload as
        { payment?: { entity?: { order_id?: string; card_id?: string } } } | undefined;
      const entity = payload?.payment?.entity;
      if (entity?.card_id !== undefined && attackOrders.has(entity.order_id ?? '')) {
        cards.add(entity.card_id);
      }
    }
    expect(cards.size).toBeLessThanOrEqual(6);
    expect(cards.size).toBeGreaterThan(0);
  });
});
