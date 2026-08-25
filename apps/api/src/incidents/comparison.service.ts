import { Injectable } from '@nestjs/common';
import { generate, SCENARIOS } from '@sentinel/corpus';
import {
  arbitrate,
  computeFeatures,
  computeTraffic,
  counterfactualFor,
  minutes,
  thresholdHash,
  type EntityKind,
  type Observation,
} from '@sentinel/detect';
import type { ComparisonCase, ComparisonResponse } from '@sentinel/contracts';

/**
 * Three look-alike scenarios, judged side by side.
 *
 * The point of the view this feeds is restraint made visible. An attack, an acquirer outage and
 * a biller's retry schedule all look like "one entity failing over and over"; the only thing
 * that separates them is what the rest of the shop was doing, and a reader who is *told* the
 * system is careful has learnt nothing. Shown three identical evidence layouts reaching three
 * different conclusions, they can see it.
 *
 * Computed from the committed corpus rather than from the database, on purpose. It has to work
 * on a clean clone with no traffic in it, the scenarios are labelled in a file that predates the
 * detector, and nothing here can be quietly improved by seeding a friendlier database.
 */
const WINDOW = { windowMs: minutes(600), halfLifeMs: minutes(5) };

/** The three that actually confuse each other, and the entity kind each is best seen through. */
const CASES: { family: keyof typeof SCENARIOS; kind: EntityKind }[] = [
  { family: 'attack_loud', kind: 'session' },
  { family: 'gateway_outage', kind: 'network' },
  { family: 'retry_storm', kind: 'session' },
];

@Injectable()
export class ComparisonService {
  compare(): ComparisonResponse {
    return {
      cases: CASES.map(({ family, kind }) => ComparisonService.judge(family, kind)),
      thresholdHash: thresholdHash(),
    };
  }

  private static judge(family: keyof typeof SCENARIOS, kind: EntityKind): ComparisonCase {
    const observations = ComparisonService.load(family);
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const traffic = computeTraffic(observations, asOf, WINDOW);

    const pick = (o: Observation): string | null =>
      kind === 'session'
        ? o.sessionPseudonym
        : kind === 'device'
          ? o.devicePseudonym
          : o.ipPseudonym;

    // The entity an analyst would be shown first: the one with the most to answer for.
    const vector = [...new Set(observations.map(pick))]
      .filter((k): k is string => k !== null)
      .map((key) => computeFeatures(kind, key, observations, asOf, WINDOW))
      .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)[0]!;

    const arbitration = arbitrate(vector, traffic);
    const spec = SCENARIOS[family];

    return {
      family,
      title: spec.title,
      classification: spec.classification,
      entityKind: kind,
      attempts: vector.attempts,
      failures: vector.failures,
      distinctCards: vector.distinctCards.exact,
      approvalRate: vector.approvalRate,
      traffic: {
        attempts: traffic.attempts,
        failures: traffic.failures,
        approvalRate: traffic.approvalRate,
        infrastructureFailureShare: traffic.infrastructureFailureShare,
        failingSessions: traffic.failingSessions,
        activeSessions: traffic.activeSessions,
        topSessionFailureShare: traffic.topSessionFailureShare,
      },
      arbitration,
      counterfactual: counterfactualFor(arbitration.best),
    };
  }

  private static load(family: keyof typeof SCENARIOS): Observation[] {
    const scenario = generate(family);
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
}
