/**
 * A short human title for an incident, derived from what actually fired.
 *
 * Not stored and not free text: a deterministic function of the rules that fired, the winning
 * hypothesis and the entity kind, so the same incident always reads the same way and the label
 * can never drift from the evidence behind it. This is a *view* of real signals, never a source
 * of them — the counts, score and arbitration remain the authority. Kept beside the rule and
 * hypothesis vocabulary it maps from so a new rule cannot be added without a title deciding what
 * it is called.
 */
export function incidentTitle(input: {
  entityKind: string;
  primaryHypothesis: string;
  firedRules: readonly string[];
}): string {
  const fired = new Set(input.firedRules);
  const has = (...rules: string[]): boolean => rules.some((rule) => fired.has(rule));

  // Most specific evidence first: many distinct cards is the signature of enumeration, whatever
  // the entity it was seen through — fast (card_spread), paced under the window (card_spread_slow),
  // or one card walked across a catalogue (card_probing). card_reuse is deliberately absent: it is
  // a mitigation (dunning, the opposite of testing) and never reaches a titled incident anyway.
  // Seen through a network it is the same abuse spread across many shoppers, which reads
  // differently to an analyst than one machine working alone.
  if (has('card_spread', 'card_spread_slow', 'card_probing')) {
    return input.entityKind === 'network' ? 'Distributed card testing' : 'Coordinated card testing';
  }
  // An attack still taking shape — the cards have not yet given it away — is named for what it is,
  // not for whichever benign-looking facet (small amounts, a velocity blip) fired first. Otherwise
  // the title would read "Unusual amount pattern" one transaction before the enumeration is
  // obvious, then flip. The facet titles below are for cases the detector did *not* judge an attack.
  if (input.primaryHypothesis === 'attack') {
    if (input.entityKind === 'device') return 'Suspicious device activity';
    if (input.entityKind === 'network') return 'Distributed card testing';
    return 'Suspicious payment activity';
  }
  if (has('small_amount_probing')) return 'Unusual amount pattern';
  if (has('velocity', 'machine_cadence')) return 'Velocity spike detected';
  if (has('approval_collapse', 'reason_mix')) return 'Multiple declines';
  if (input.primaryHypothesis === 'retry_storm') return 'Repeated retries';
  if (input.primaryHypothesis === 'outage') return 'Gateway failures';
  return 'Unusual payment activity';
}
