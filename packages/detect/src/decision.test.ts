import { describe, expect, it } from 'vitest';
import { combineDecision, modelFlagsMissedEntity, type ModelVerdict } from './decision.js';
import type { Hypothesis } from './hypothesis.js';

const rules = (
  decision: 'contain' | 'review' | 'monitor' | 'none',
  best: Hypothesis,
  ...reasons: string[]
) => ({ decision, best, reasons });

const verdict = (risk: number): ModelVerdict => ({ risk });

describe('combineDecision — the model on its leash', () => {
  it('leaves the rules alone when there is no model (degraded:model)', () => {
    const out = combineDecision(rules('contain', 'attack', 'attack_clearly_best_supported'), null);
    expect(out.decision).toBe('contain');
    expect(out.influence).toBe('none');
  });

  it('leaves the rules alone when the risk sits in the passenger band', () => {
    // Above the benign bar, below the high-risk bar: the model is not sure enough to move anything.
    const out = combineDecision(rules('none', 'insufficient_evidence'), verdict(0.4));
    expect(out.influence).toBe('none');
  });

  it('escalates: rules were unsure, the model scores high risk', () => {
    const out = combineDecision(rules('monitor', 'insufficient_evidence'), verdict(0.9));
    expect(out.decision).toBe('review');
    expect(out.influence).toBe('escalated');
    expect(out.reasons).toContain('model_flagged_high_risk');
  });

  it('escalates from a clean "none" too', () => {
    const out = combineDecision(rules('none', 'insufficient_evidence'), verdict(0.9));
    expect(out.decision).toBe('review');
    expect(out.influence).toBe('escalated');
  });

  it('does NOT escalate when the arbitration confidently explains it as benign', () => {
    // A high-volume but innocent entity: the model is suspicious, but the arbitration positively
    // identified an outage. The deterministic explanation overrules the model's push.
    const out = combineDecision(rules('monitor', 'outage', 'suppressed_by_outage'), verdict(0.9));
    expect(out.decision).toBe('monitor');
    expect(out.influence).toBe('none');
  });

  it('de-escalates: rules want to contain, the model scores low risk', () => {
    const out = combineDecision(
      rules('contain', 'attack', 'attack_clearly_best_supported'),
      verdict(0.05),
    );
    expect(out.decision).toBe('review'); // a person looks; the shopper is not blocked automatically
    expect(out.influence).toBe('deescalated');
    expect(out.reasons).toContain('model_scores_low_risk');
  });

  it('corroborates without changing the decision when the model agrees with a containment', () => {
    const out = combineDecision(
      rules('contain', 'attack', 'attack_clearly_best_supported'),
      verdict(0.9),
    );
    expect(out.decision).toBe('contain');
    expect(out.influence).toBe('corroborated');
    expect(out.reasons).toContain('model_agrees_attack');
  });

  it('never turns a review into a containment — the model cannot escalate a shopper into a block', () => {
    const out = combineDecision(rules('review', 'attack', 'counts_not_confirmed'), verdict(0.9));
    // The model agrees it is high risk, but review does not become contain: containment stays gated
    // on the deterministic evidence, and the model may only corroborate it.
    expect(out.decision).toBe('review');
    expect(out.influence).toBe('corroborated');
  });

  it('does not touch a suppression the model also scores low', () => {
    const out = combineDecision(rules('monitor', 'outage', 'suppressed_by_outage'), verdict(0.05));
    expect(out.decision).toBe('monitor');
    expect(out.influence).toBe('none');
  });
});

describe('modelFlagsMissedEntity — the model raising a case the rules never opened', () => {
  it('flags a high-risk entity the rules missed', () => {
    expect(modelFlagsMissedEntity(verdict(0.85))).toBe(true);
  });

  it('needs the higher risk bar for speaking alone', () => {
    // Enough to move a decision (>= modelHighRisk 0.7) but not to open a case alone (< modelFlagRisk 0.8).
    expect(modelFlagsMissedEntity(verdict(0.7))).toBe(false);
  });

  it('never flags a low risk or an absent model', () => {
    expect(modelFlagsMissedEntity(verdict(0.3))).toBe(false);
    expect(modelFlagsMissedEntity(null)).toBe(false);
  });
});
