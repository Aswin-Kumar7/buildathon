import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Arbitration, FeatureVector, TrafficContext } from '@sentinel/detect';
import { seeded } from '@sentinel/corpus';
import { InvalidPolicy, parsePolicy, policyHash, type Policy } from './policy.js';
import { ACTIONS, isCustomerImpacting, type Action } from './actions.js';
import { decide, type SystemState } from './decide.js';

const SOURCE = readFileSync('../../policy.yaml', 'utf8');
const POLICY = parsePolicy(SOURCE);

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

function vector(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    entityKind: 'session',
    entityKey: 'v1:session-a',
    asOf: T0,
    window: { windowMs: 1_800_000, halfLifeMs: 300_000 },
    attemptRate: 2,
    failureRate: 1.9,
    distinctCards: { estimate: 40, errorBound: 1, exact: 40 },
    distinctSessions: { estimate: 1, errorBound: 1, exact: 1 },
    distinctNetworks: { estimate: 1, errorBound: 1, exact: 1 },
    attempts: 40,
    failures: 39,
    approvalRate: 0.02,
    infrastructureFailureShare: 0,
    reasonConcentration: 0.5,
    medianAmountPaise: 100,
    smallAmountShare: 0.9,
    burstiness: 0.2,
    recoveryRate: 0,
    recoveredOrders: 0,
    lastSeenAt: T0,
    firstSeenAt: T0,
    maxOrdersPerCard: 0,
    distinctCardsLongSpan: null,
    ...overrides,
  };
}

function traffic(overrides: Partial<TrafficContext> = {}): TrafficContext {
  return {
    asOf: T0,
    windowMs: 1_800_000,
    attempts: 60,
    failures: 45,
    approvalRate: 0.25,
    infrastructureFailureShare: 0,
    failingSessions: 2,
    activeSessions: 40,
    topSessionFailureShare: 0.9,
    cardTestingSessions: 0,
    failingSessionApprovalRate: 0,
    distinctCards: 45,
    distinctFailingIssuers: 0,
    ...overrides,
  };
}

/** An arbitration that names `best` and gives the attack hypothesis `support`. */
function arbitration(
  best: Arbitration['best'] = 'attack',
  support = 0.9,
  overrides: Partial<Arbitration> = {},
): Arbitration {
  const others = (
    ['attack', 'outage', 'retry_storm', 'healthy_traffic', 'insufficient_evidence'] as const
  ).filter((h) => h !== best);

  return {
    best,
    runnerUp: others[0]!,
    margin: 0.3,
    decision: best === 'attack' ? 'contain' : 'none',
    abstained: false,
    reasons: [],
    fits: [
      { hypothesis: best, support, probability: 0.6, expectations: [] },
      ...others.map((hypothesis) => ({
        hypothesis,
        support: 0.2,
        probability: 0.1,
        expectations: [],
      })),
    ],
    ...overrides,
  };
}

/** Attack support when the winner is something else, so the two can be varied independently. */
function attackSupport(base: Arbitration, support: number): Arbitration {
  return {
    ...base,
    fits: base.fits.map((fit) => (fit.hypothesis === 'attack' ? { ...fit, support } : fit)),
  };
}

const state = (overrides: Partial<SystemState> = {}): SystemState => ({
  now: T0,
  featuresAsOf: T0,
  activeContainments: 0,
  containmentsInLastHour: 0,
  ...overrides,
});

const at = (overrides: {
  arbitration?: Arbitration;
  vector?: Partial<FeatureVector>;
  traffic?: Partial<TrafficContext>;
  state?: Partial<SystemState>;
  policy?: Policy;
}) =>
  decide({
    arbitration: overrides.arbitration ?? arbitration(),
    vector: vector(overrides.vector),
    traffic: traffic(overrides.traffic),
    state: state(overrides.state),
    policy: overrides.policy ?? POLICY,
  });

describe('the policy file', () => {
  it('parses the one this repository ships', () => {
    expect(POLICY.version).toBeGreaterThanOrEqual(1);
    expect(POLICY.thresholds.contain).toBeGreaterThanOrEqual(POLICY.thresholds.stepUp);
  });

  it('refuses a policy with a hole in it rather than defaulting', () => {
    // A missing threshold is not zero. It means the file in front of us is not the policy
    // anybody intended, and guessing would produce behaviour nobody can predict by reading it.
    expect(() => parsePolicy('version: 1\nkillSwitch: false\n')).toThrow(InvalidPolicy);

    try {
      parsePolicy('version: 1\nkillSwitch: false\n');
    } catch (error) {
      expect((error as InvalidPolicy).problems.length).toBeGreaterThan(3);
    }
  });

  it('reports every problem at once, not the first', () => {
    try {
      parsePolicy('version: "one"\nkillSwitch: "no"\n');
    } catch (error) {
      const { problems } = error as InvalidPolicy;
      expect(problems.some((p) => p.includes('version'))).toBe(true);
      expect(problems.some((p) => p.includes('killSwitch'))).toBe(true);
    }
  });

  it('refuses a policy where blocking needs less evidence than asking', () => {
    // Refusing a payment is a bigger act than asking for another factor, so it cannot need less
    // evidence. No per-field check can see this; it is a relationship between two of them.
    const broken = SOURCE.replace('contain: 0.75', 'contain: 0.10');
    expect(() => parsePolicy(broken)).toThrow(/cannot need less evidence/);
  });

  it('hashes the values, not the formatting', () => {
    // Comments and whitespace are not policy. Reflowing the file must not look like a change,
    // or the hash stops meaning anything and nobody looks at it.
    const reformatted = `# a new comment\n\n${SOURCE}`;
    expect(policyHash(parsePolicy(reformatted))).toBe(policyHash(POLICY));

    const changed = parsePolicy(SOURCE.replace('defaultMinutes: 30', 'defaultMinutes: 31'));
    expect(policyHash(changed)).not.toBe(policyHash(POLICY));
  });
});

describe('every action is reversible and everything visible expires', () => {
  it('holds for all five', () => {
    // The constraint the list was written under, checked rather than remembered. A permanent
    // block is a customer who can never pay again while nothing appears to have gone wrong.
    for (const shape of Object.values(ACTIONS)) {
      expect(shape.reversible, shape.action).toBe(true);
      if (isCustomerImpacting(shape.action)) expect(shape.expires, shape.action).toBe(true);
    }
  });

  it('never proposes something visible without an expiry', () => {
    const random = seeded(20260825);

    for (let run = 0; run < 300; run += 1) {
      const support = random();
      const decision = at({
        arbitration: attackSupport(arbitration('attack', support), support),
        vector: { attempts: 6 + Math.floor(random() * 60) },
        state: { activeContainments: Math.floor(random() * 3) },
      });

      if (isCustomerImpacting(decision.action)) {
        expect(decision.expiresAfterMinutes, decision.action).not.toBeNull();
        expect(decision.expiresAfterMinutes!).toBeGreaterThan(0);
        expect(decision.expiresAfterMinutes!).toBeLessThanOrEqual(POLICY.containment.maxMinutes);
      }
    }
  });
});

describe('the kill switch', () => {
  it('stops everything, whatever the evidence', () => {
    const halted: Policy = { ...POLICY, killSwitch: true };
    const decision = at({ policy: halted, arbitration: arbitration('attack', 1) });

    expect(decision.action).toBe('observe');
    expect(decision.refusals).toContain('kill_switch_engaged');
    expect(decision.approvalsRequired).toBe(0);
  });

  it('cannot be overridden by anything else in the policy', () => {
    // Checked first and unconditionally. The one control that has to work when every assumption
    // behind the others has failed.
    const random = seeded(7);
    const halted: Policy = { ...POLICY, killSwitch: true };

    for (let run = 0; run < 200; run += 1) {
      const decision = at({
        policy: halted,
        arbitration: attackSupport(arbitration('attack', random()), random()),
        vector: { attempts: Math.floor(random() * 100) },
        state: { featuresAsOf: T0 - Math.floor(random() * 3_600_000) },
      });

      expect(isCustomerImpacting(decision.action)).toBe(false);
    }
  });
});

describe('the degradation matrix', () => {
  it('refuses anything the customer would notice when features are stale', () => {
    // The whole rule, in one line: if we cannot see clearly, we do not touch a customer.
    const decision = at({
      state: { featuresAsOf: T0 - (POLICY.degradation.maxFeatureAgeMinutes + 1) * 60_000 },
    });

    expect(isCustomerImpacting(decision.action)).toBe(false);
    expect(decision.refusals).toContain('feature_state_is_stale');
  });

  it('refuses when the counts were never confirmed', () => {
    const decision = at({
      vector: { distinctCards: { estimate: 40, errorBound: 1, exact: null } },
    });

    expect(isCustomerImpacting(decision.action)).toBe(false);
    expect(decision.refusals).toContain('counts_never_confirmed');
  });

  it('refuses when arbitration declined to decide', () => {
    const decision = at({
      arbitration: arbitration('attack', 0.9, { abstained: true }),
    });

    expect(isCustomerImpacting(decision.action)).toBe(false);
    expect(decision.refusals).toContain('arbitration_abstained');
  });

  it('still escalates, because telling a person is not done to anybody', () => {
    // Degradation must not mean silence. A detector that quietly stops protecting anything is
    // worse than one that says it has stopped.
    const decision = at({ state: { featuresAsOf: T0 - 3_600_000 } });

    expect(decision.action).toBe('escalate');
    expect(decision.refusals.length).toBeGreaterThan(0);
  });
});

describe('impact caps', () => {
  it('stops a confident mistake becoming a large one', () => {
    const decision = at({
      state: { activeContainments: POLICY.impactCaps.maxActiveContainments },
    });

    expect(isCustomerImpacting(decision.action)).toBe(false);
    expect(decision.refusals).toContain('too_many_active_containments');
  });

  it('refuses to contain too much of the shop at once', () => {
    // A detector convinced that a large share of the shop is an attack is far more likely to be
    // wrong than right.
    const decision = at({ traffic: { activeSessions: 40 }, state: { activeContainments: 3 } });

    expect(decision.refusals).toContain('would_contain_too_much_of_the_shop');
    expect(isCustomerImpacting(decision.action)).toBe(false);
  });

  it('does not apply a share cap to a shop too small to take a share of', () => {
    // One of three customers is a third of everything, which would make containment impossible
    // in a small shop while looking like a safety rule doing its job. The absolute caps still
    // hold there, and they are the ones that mean something at that size.
    const decision = at({ traffic: { activeSessions: 3 } });

    expect(decision.refusals).not.toContain('would_contain_too_much_of_the_shop');
    expect(decision.action).toBe('contain');
  });

  it('holds the hourly cap regardless of how many are active now', () => {
    const decision = at({
      state: {
        activeContainments: 0,
        containmentsInLastHour: POLICY.impactCaps.maxContainmentsPerHour,
      },
    });

    expect(decision.refusals).toContain('hourly_containment_cap_reached');
  });
});

describe('the allowlist', () => {
  it('is never acted against, whatever the evidence', () => {
    // For known billers, load tests and partners: traffic whose failure pattern is legitimately
    // indistinguishable from an attack.
    const listed: Policy = {
      ...POLICY,
      allowlist: { ...POLICY.allowlist, sessions: ['v1:session-a'] },
    };
    const decision = at({ policy: listed, arbitration: arbitration('attack', 1) });

    expect(decision.action).toBe('observe');
    expect(decision.refusals).toContain('entity_is_allowlisted');
  });

  it('applies to the right entity kind and not the others', () => {
    const listed: Policy = {
      ...POLICY,
      allowlist: { ...POLICY.allowlist, networks: ['v1:session-a'] },
    };

    // Same key, wrong list: a session is not exempted by a network allowlist entry.
    expect(at({ policy: listed }).refusals).not.toContain('entity_is_allowlisted');
  });
});

describe('approval', () => {
  it('never contains without a person agreeing', () => {
    // A system that can block a paying customer with nobody in the loop is one bad threshold
    // away from an outage of its own.
    const random = seeded(99);

    for (let run = 0; run < 200; run += 1) {
      const support = 0.75 + random() * 0.25;
      const decision = at({ arbitration: attackSupport(arbitration('attack', support), support) });

      if (decision.action === 'contain') expect(decision.approvalsRequired).toBeGreaterThan(0);
    }
  });

  it('asks for a second person as the case for acting gets weaker', () => {
    // Dual approval keys on the cost of being *wrong*, which rises as confidence falls — so the
    // less sure the system is, the more people have to agree. The genuinely unsure cases never
    // get this far; abstention and the degradation matrix have already stopped them. This is
    // the middle band, which is exactly where a second opinion is worth having.
    const lessSure = arbitration('attack', 0.95);
    const decision = at({
      arbitration: {
        ...lessSure,
        fits: lessSure.fits.map((fit) =>
          fit.hypothesis === 'attack' ? { ...fit, probability: 0.5 } : fit,
        ),
      },
    });

    expect(decision.action).toBe('contain');
    expect(decision.approvalsRequired).toBe(2);
    expect(decision.reasons).toContain('impact_above_dual_approval_threshold');
  });

  it('is content with one person when the case is strong', () => {
    const decision = at({ arbitration: attackSupport(arbitration('attack', 0.95), 0.95) });

    expect(decision.action).toBe('contain');
    expect(decision.approvalsRequired).toBe(1);
  });

  it('needs nobody for actions that touch no one', () => {
    const decision = at({ arbitration: arbitration('outage') });

    expect(isCustomerImpacting(decision.action)).toBe(false);
    expect(decision.approvalsRequired).toBe(0);
  });
});

describe('suppression carries through to the proposal', () => {
  it('proposes nothing against a better explanation', () => {
    for (const best of ['outage', 'retry_storm', 'healthy_traffic'] as const) {
      const decision = at({ arbitration: arbitration(best) });

      expect(isCustomerImpacting(decision.action), best).toBe(false);
      expect(decision.refusals).toContain(`suppressed_by_${best}`);
    }
  });

  it('escalates rather than falls silent when arbitration wanted a person', () => {
    const decision = at({
      arbitration: arbitration('insufficient_evidence', 0.1, { decision: 'review' }),
    });

    expect(decision.action).toBe('escalate');
  });
});

describe('expected cost', () => {
  it('shows both directions rather than averaging them', () => {
    // Averaging would hide which way the asymmetry runs, which is the only thing about it worth
    // knowing.
    const decision = at({});

    expect(decision.expectedCost.ifWeAct).toBeGreaterThanOrEqual(0);
    expect(decision.expectedCost.ifWeWait).toBeGreaterThanOrEqual(0);
    expect(decision.expectedCost).not.toHaveProperty('expected');
  });

  it('costs acting more when the traffic is probably legitimate', () => {
    const confident = at({ arbitration: arbitration('attack', 0.95) });
    const unsure = at({
      arbitration: {
        ...arbitration('attack', 0.95),
        fits: arbitration('attack', 0.95).fits.map((fit) =>
          fit.hypothesis === 'attack' ? { ...fit, probability: 0.3 } : fit,
        ),
      },
    });

    expect(unsure.expectedCost.ifWeAct).toBeGreaterThan(confident.expectedCost.ifWeAct);
  });
});

describe('the decision as a whole', () => {
  it('records which policy produced it', () => {
    // "Why did it do that six weeks ago" needs an answer that does not depend on what the file
    // says today.
    const decision = at({});

    expect(decision.policyVersion).toBe(POLICY.version);
    expect(decision.policyHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('emits codes, never prose', () => {
    const random = seeded(4242);

    for (let run = 0; run < 300; run += 1) {
      const decision = at({
        arbitration: attackSupport(arbitration('attack', random()), random()),
        state: {
          featuresAsOf: T0 - Math.floor(random() * 1_800_000),
          activeContainments: Math.floor(random() * 8),
        },
      });

      for (const code of [...decision.reasons, ...decision.refusals]) {
        expect(code).toMatch(/^[a-z0-9_.]+$/);
      }
    }
  });

  it('gives the same answer twice', () => {
    expect(JSON.stringify(at({}))).toBe(JSON.stringify(at({})));
  });

  it('only ever proposes an action it knows about', () => {
    const random = seeded(31337);
    const known = new Set<Action>(Object.keys(ACTIONS) as Action[]);

    for (let run = 0; run < 300; run += 1) {
      const best = (['attack', 'outage', 'retry_storm', 'healthy_traffic'] as const)[
        Math.floor(random() * 4)
      ]!;
      expect(known.has(at({ arbitration: arbitration(best, random()) }).action)).toBe(true);
    }
  });
});
