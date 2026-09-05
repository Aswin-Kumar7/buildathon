import { describe, expect, it } from 'vitest';
import type { EvidenceDto } from '@sentinel/contracts';
import { evidenceThreshold } from './evidence.js';

const ev = (code: string, observed: number, threshold: number): EvidenceDto =>
  ({ rule: 'x', code, observed, threshold, weight: 0.1 }) as unknown as EvidenceDto;

describe('evidenceThreshold', () => {
  // packages/detect/src/rules.ts is the source of truth for which direction each rule tests.
  // These two fire when the observed value is UNDER the threshold; everything else fires over it.
  it('shows a ceiling for the rules that fire on a lower-than test', () => {
    expect(evidenceThreshold(ev('approval_rate_below_floor', 0.05, 0.2))).toContain('≤');
    // The regression: this code carries neither "below" nor "floor", so a /below|floor/ pattern
    // rendered it as "≥", asserting the opposite of the test that fired the rule.
    expect(evidenceThreshold(ev('inter_arrival_variation_low', 0.12, 0.35))).toContain('≤');
  });

  it('shows a floor for the rules that fire on a greater-than test', () => {
    for (const code of [
      'attempt_rate_above_threshold',
      'distinct_cards_above_threshold',
      'cards_per_attempt_above_threshold',
      'cards_reused_across_attempts',
      'orders_recovered_after_failure',
    ]) {
      expect(evidenceThreshold(ev(code, 9, 3))).toContain('≥');
    }
  });
});
