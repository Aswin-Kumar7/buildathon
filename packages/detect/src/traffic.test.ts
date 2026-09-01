/**
 * The dilution-proof shop-wide signals.
 *
 * A genuinely distributed attack is invisible to every per-entity rule — sprayed too thin for any
 * one session, device or address to trip a threshold — so it can only be caught at the shop level.
 * The obvious shop-level signal, a collapse in the shop-wide approval rate, has a fatal blind spot:
 * a legitimate surge sharing the same thirty-minute window keeps approving real shoppers and lifts
 * that rate back up, hiding the attack underneath it. This is not hypothetical — it is exactly what
 * happens when a distributed attack runs during a flash sale, or inside the mixed campaign.
 *
 * {@link computeTraffic.cardTestingSessions} is the fix: a direct count of sessions that only ever
 * failed, across two or more distinct cards, and not gateway-blamed. A surge keeps approving, so its
 * sessions never enter that cohort and cannot dilute it. These tests pin both halves of the claim —
 * the attack produces the cohort, the benign shapes do not, and the cohort survives being blended
 * with a sale even though the shop-wide approval rate does not.
 */

import { describe, expect, it } from 'vitest';
import { generate, type ScenarioFamily } from '@sentinel/corpus';
import { type Observation } from './features.js';
import { computeTraffic } from './traffic.js';

function toObservations(family: ScenarioFamily, seed: number): Observation[] {
  const scenario = generate(family, seed, { realisticMethods: true });
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));
  return scenario.events.flatMap((event): Observation[] => {
    const body = event.body as {
      created_at: number;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };
    const entity = body.payload?.payment?.entity;
    if (entity === undefined) return [];
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const orderId = str(entity['order_id']) ?? '';
    const checkout = checkouts.get(orderId);
    const status = str(entity['status']);
    return [
      {
        at: body.created_at * 1000,
        razorpayOrderId: orderId,
        razorpayPaymentId: str(entity['id']) ?? '',
        outcome:
          status === 'captured'
            ? 'captured'
            : status === 'failed'
              ? 'failed'
              : status === 'authorized'
                ? 'authorized'
                : 'other',
        amountPaise: typeof entity['amount'] === 'number' ? entity['amount'] : null,
        cardId: str(entity['card_id']),
        errorSource: str(entity['error_source']),
        errorReason: str(entity['error_reason']),
        sessionPseudonym: checkout ? `v1:${checkout.clientSessionId}` : null,
        devicePseudonym: checkout ? `v1:${checkout.deviceId}` : null,
        ipPseudonym: checkout ? `v1:${checkout.ip}` : null,
        userAgentFamily: checkout?.userAgentFamily ?? null,
      },
    ];
  });
}

const endsAt = (obs: readonly Observation[]): number => Math.max(...obs.map((o) => o.at));

/** Slide a scenario's observations so their last event lands at `target` — used to overlap two
 *  independently-seeded scenarios inside one window, the way the live 30-minute window sees them. */
function shiftTo(obs: readonly Observation[], target: number): Observation[] {
  const delta = target - endsAt(obs);
  return obs.map((o) => ({ ...o, at: o.at + delta }));
}

// The gate's threshold, asserted against directly so the test moves with it.
const MIN_TESTING_SESSIONS = 5;

describe('computeTraffic — enumeration cohort', () => {
  it('a distributed attack produces a card-testing cohort with near-zero approval among failures', () => {
    const obs = toObservations('attack_distributed', 101);
    const t = computeTraffic(obs, endsAt(obs));

    expect(t.cardTestingSessions).toBeGreaterThanOrEqual(MIN_TESTING_SESSIONS);
    // The attack's sessions never capture, so the score's basis reads near-certain.
    expect(t.failingSessionApprovalRate).toBeLessThan(0.1);
  });

  it.each<[ScenarioFamily]>([
    ['flash_sale'],
    ['customer_error'],
    ['normal_traffic'],
    ['gateway_outage'],
  ])('a benign shape (%s) does not fabricate a cohort', (family) => {
    const obs = toObservations(family, 101);
    const t = computeTraffic(obs, endsAt(obs));
    expect(t.cardTestingSessions).toBeLessThan(MIN_TESTING_SESSIONS);
  });

  it('the cohort survives being blended with a flash sale that the approval rate does not', () => {
    const attack = toObservations('attack_distributed', 101);
    const asOf = endsAt(attack);
    // A sale ending in the same window: hundreds of approving shoppers on top of the thin attack.
    // A DIFFERENT seed, so the two draw disjoint session ids — the live sim gives every family and
    // run its own seed for exactly this reason; sharing one would fabricate id collisions (an attack
    // session inheriting the sale's captures) that real distinct sessions never produce.
    const sale = shiftTo(toObservations('flash_sale', 4242), asOf);
    const blended = [...attack, ...sale];

    const t = computeTraffic(blended, asOf);

    // The shop-wide approval rate is lifted well clear of the collapse floor by the sale — the exact
    // condition under which the old approval-only gate went blind.
    expect(t.approvalRate).toBeGreaterThan(0.4);
    // But the cohort is untouched: the sale's shoppers approve, so they never join it.
    expect(t.cardTestingSessions).toBeGreaterThanOrEqual(MIN_TESTING_SESSIONS);
  });
});
