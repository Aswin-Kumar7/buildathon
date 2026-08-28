import { describe, expect, it } from 'vitest';
import { incidentTitle } from './title.js';

describe('incidentTitle', () => {
  it('names card enumeration from a card-spread signal, whatever the entity', () => {
    expect(
      incidentTitle({
        entityKind: 'session',
        primaryHypothesis: 'attack',
        firedRules: ['card_spread', 'approval_collapse'],
      }),
    ).toBe('Coordinated card testing');
  });

  it('names device abuse when an attack is seen through a device without card spread', () => {
    expect(
      incidentTitle({
        entityKind: 'device',
        primaryHypothesis: 'attack',
        firedRules: ['velocity'],
      }),
    ).toBe('Suspicious device activity');
  });

  it('names a forming attack generically, not by whichever facet fired first', () => {
    // The fix for the title "flip": a card-testing run trips small-amount probing a transaction or
    // two before the cards give it away. It must not read "Unusual amount pattern" in that window
    // and then change — an attack still taking shape is "Suspicious payment activity" until the
    // enumeration is confirmed, at which point it becomes card testing.
    expect(
      incidentTitle({
        entityKind: 'session',
        primaryHypothesis: 'attack',
        firedRules: ['small_amount_probing', 'velocity'],
      }),
    ).toBe('Suspicious payment activity');
  });

  it('names amount probing only where it was not judged an attack', () => {
    expect(
      incidentTitle({
        entityKind: 'session',
        primaryHypothesis: 'insufficient_evidence',
        firedRules: ['small_amount_probing'],
      }),
    ).toBe('Unusual amount pattern');
  });

  it('names repeated declines where it was not judged an attack', () => {
    expect(
      incidentTitle({
        entityKind: 'session',
        primaryHypothesis: 'insufficient_evidence',
        firedRules: ['approval_collapse'],
      }),
    ).toBe('Multiple declines');
  });

  it('names a retry storm from the winning hypothesis', () => {
    expect(
      incidentTitle({ entityKind: 'session', primaryHypothesis: 'retry_storm', firedRules: [] }),
    ).toBe('Repeated retries');
  });

  it('names an acquirer outage', () => {
    expect(
      incidentTitle({ entityKind: 'network', primaryHypothesis: 'outage', firedRules: [] }),
    ).toBe('Gateway failures');
  });

  it('falls back to a neutral title when nothing specific is known', () => {
    expect(
      incidentTitle({
        entityKind: 'session',
        primaryHypothesis: 'insufficient_evidence',
        firedRules: [],
      }),
    ).toBe('Unusual payment activity');
  });
});
