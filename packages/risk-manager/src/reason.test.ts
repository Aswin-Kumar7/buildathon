import { describe, expect, it } from 'vitest';
import {
  ceilingAction,
  clampToCeiling,
  groundingHash,
  mappedAction,
  type RiskFacts,
} from './facts.js';
import {
  assessWith,
  localSelector,
  runRiskFallback,
  templateSelector,
  RiskUnusable,
  type RiskSelector,
} from './reason.js';

function facts(over: Partial<RiskFacts> = {}): RiskFacts {
  return {
    entityKind: 'network',
    severity: 'high',
    score: 0.9,
    recommendedDecision: 'contain',
    attempts: 36,
    failures: 36,
    distinctCards: 36,
    evidence: [
      { rule: 'card_spread', code: 'card_spread', observed: 36, threshold: 8, weight: 0.5 },
      {
        rule: 'approval_collapse',
        code: 'approval_collapse',
        observed: 0.02,
        threshold: 0.2,
        weight: 0.3,
      },
    ],
    best: 'attack',
    runnerUp: 'retry_storm',
    margin: 0.2,
    modelInfluence: 'corroborated',
    model: { risk: 1, predictedClass: 'abuse', band: 'contain_eligible', abstained: false },
    modelAvailable: true,
    changeFired: null,
    rehearsal: true,
    policy: { action: 'contain', approvalsRequired: 1, refusals: [] },
    ...over,
  };
}

const stepUp = { action: 'step_up' as const, approvalsRequired: 0, refusals: [] as string[] };

describe('ceiling', () => {
  it('allows contain only when the rules recommended it and policy would support it', () => {
    expect(ceilingAction(facts())).toBe('contain');
  });

  it('downgrades contain to review when policy would only step up', () => {
    expect(ceilingAction(facts({ policy: stepUp }))).toBe('review');
  });

  it('downgrades contain to review when policy has any refusal', () => {
    expect(
      ceilingAction(
        facts({
          policy: {
            action: 'contain',
            approvalsRequired: 1,
            refusals: ['hourly_containment_cap_reached'],
          },
        }),
      ),
    ).toBe('review');
  });

  it('maps arbitration none to monitor', () => {
    expect(ceilingAction(facts({ recommendedDecision: 'none' }))).toBe('monitor');
    expect(mappedAction('none')).toBe('monitor');
  });

  it('never lets a proposed action exceed the ceiling', () => {
    expect(clampToCeiling('contain', facts({ policy: stepUp }))).toBe('review');
    expect(clampToCeiling('monitor', facts())).toBe('monitor');
  });
});

describe('assessWith (template floor)', () => {
  it('produces a grounded recommendation from real facts, dropping nothing', async () => {
    const a = await assessWith(facts(), templateSelector);
    expect(a.action).toBe('contain');
    expect(a.source).toBe('template');
    expect(a.dropped).toBe(0);
    expect(a.keyReasons.length).toBeGreaterThan(0);
    // Values are bound from facts, not invented.
    expect(a.keyReasons.map((r) => r.text).join(' ')).toContain('36 different cards');
    expect(a.rationaleClaimIds).toEqual(a.keyReasons.map((r) => r.id));
  });

  it('marks a policy-downgraded contain as diverging, with the refusal available', async () => {
    const a = await assessWith(
      facts({
        policy: {
          action: 'contain',
          approvalsRequired: 1,
          refusals: ['too_many_active_containments'],
        },
      }),
      templateSelector,
    );
    expect(a.action).toBe('review');
    expect(a.alignment).toBe('diverges');
    expect(a.refusals).toContain('too_many_active_containments');
  });

  it('reads as aligned when the action matches the ceiling and the model corroborated', async () => {
    const a = await assessWith(facts(), localSelector);
    expect(a.alignment).toBe('aligned');
  });
});

describe('fact guard', () => {
  it('drops ids that are not in the catalog and falls to the floor when none survive', async () => {
    const bogus: RiskSelector = {
      source: 'live',
      select: () => ({ action: 'contain', reasonIds: ['nope', 'still_nope'], changeIds: [] }),
    };
    // On its own the bogus tier is unusable (reasons exist, none survive) → it must throw.
    await expect(assessWith(facts(), bogus)).rejects.toBeInstanceOf(RiskUnusable);
    // In a ladder it descends to the template, which always yields a usable recommendation.
    const a = await runRiskFallback(facts(), [bogus, templateSelector]);
    expect(a.source).toBe('template');
    expect(a.keyReasons.length).toBeGreaterThan(0);
  });

  it('clamps a live-proposed action that exceeds the ceiling', async () => {
    const overreach: RiskSelector = {
      source: 'live',
      select: () => ({ action: 'contain', reasonIds: ['attempt_volume'], changeIds: [] }),
    };
    const a = await assessWith(facts({ policy: stepUp }), overreach);
    expect(a.action).toBe('review'); // clamped down from the model's 'contain'
  });
});

describe('model-authored rationale (prose guard)', () => {
  const authoring = (rationale: string): RiskSelector => ({
    source: 'live',
    select: () => ({ action: 'contain', reasonIds: ['attempt_volume'], changeIds: [], rationale }),
  });

  it('uses the model’s own sentence when every number it cites is grounded', async () => {
    const a = await assessWith(
      facts(),
      authoring('All 36 attempts came from a single network — this is card testing.'),
    );
    expect(a.rationaleAuthored).toBe(true);
    expect(a.rationale).toContain('36 attempts');
  });

  it('rejects a fabricated number and falls back to the bound line', async () => {
    const a = await assessWith(facts(), authoring('A massive 5000 cards were tried in seconds.'));
    expect(a.rationaleAuthored).toBe(false);
    expect(a.rationale).not.toContain('5000'); // the deterministic line, not the invented number
  });

  it('accepts a qualitative sentence that cites no numbers', async () => {
    const a = await assessWith(
      facts(),
      authoring('This looks like automated card testing from a single source.'),
    );
    expect(a.rationaleAuthored).toBe(true);
    expect(a.rationale).toContain('automated card testing');
  });

  it('leaves the deterministic tiers unauthored', async () => {
    const a = await assessWith(facts(), templateSelector);
    expect(a.rationaleAuthored).toBe(false);
  });
});

describe('grounding hash', () => {
  it('is stable for identical facts and changes when the evidence changes', () => {
    expect(groundingHash(facts())).toBe(groundingHash(facts()));
    expect(groundingHash(facts())).not.toBe(groundingHash(facts({ score: 0.5 })));
  });
});
