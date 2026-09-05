import { describe, expect, it } from 'vitest';
import { titleFor } from './title.js';

// The failure this guards is ordering, not wording: a detail route whose pattern sits below the
// list route it lives under gets swallowed by it, and every incident would be titled "Incidents".
// Cheap to get wrong, invisible in review, and only noticed once a tab is already mislabelled.

describe('titleFor', () => {
  it('names the landing page for what the product is', () => {
    expect(titleFor('/')).toBe('Sentinel | Card testing detection');
  });

  it('puts the page name first, because tabs truncate from the right', () => {
    expect(titleFor('/console/incidents')).toBe('Incidents | Sentinel');
    expect(titleFor('/login')).toBe('Sign in | Sentinel');
  });

  it.each([
    ['/console', 'Overview'],
    ['/console/attempts', 'Payment attempts'],
    ['/console/incidents', 'Incidents'],
    ['/console/policy', 'Policy'],
    ['/console/policy/history', 'Policy history'],
    ['/console/audit', 'Audit trail'],
    ['/console/scenarios', 'Simulation'],
    ['/console/settings', 'Settings'],
    ['/console/features', 'Feature inspector'],
    ['/console/health', 'System health'],
  ])('names %s', (path, name) => {
    expect(titleFor(path)).toBe(`${name} | Sentinel`);
  });

  it('tells a detail page apart from the list it sits under', () => {
    expect(titleFor('/console/incidents/9f2c1a44-0d3e-4c77-9a55-1b2c3d4e5f60')).toBe(
      'Incident | Sentinel',
    );
    expect(titleFor('/console/attempts/pay_QxYz123')).toBe('Payment attempt | Sentinel');
  });

  it('does not let the policy list swallow its history page', () => {
    expect(titleFor('/console/policy/history')).not.toBe('Policy | Sentinel');
  });

  it('tolerates a trailing slash, which the router will happily produce', () => {
    expect(titleFor('/console/')).toBe('Overview | Sentinel');
    expect(titleFor('/console/attempts/')).toBe('Payment attempts | Sentinel');
  });

  it('falls back to the bare product name on a path that is not a page', () => {
    expect(titleFor('/console/nope')).toBe('Sentinel');
    expect(titleFor('/whatever')).toBe('Sentinel');
  });
});
