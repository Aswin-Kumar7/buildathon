/**
 * Wording for audit-entry kinds and divergence reasons.
 *
 * Same arrangement as everywhere else — the API emits codes, the sentences live here, and a code
 * with no entry still renders legibly rather than vanishing.
 */
const KINDS: Record<string, string> = {
  'incident.transition': 'Incident moved',
  'containment.proposed': 'Action proposed',
  'containment.approved': 'Approved',
  'containment.rejected': 'Rejected',
  'containment.activated': 'Applied',
  'containment.extended': 'Extended',
  'containment.released': 'Released early',
  'containment.expired': 'Expired',
};

export const kindLabel = (kind: string): string => KINDS[kind] ?? kind.replace(/[._]/g, ' ');

const REASONS: Record<string, string> = {
  'hash-mismatch': 'a field in that entry was changed after it was written',
  'broken-link': 'that entry no longer links to the one before it — a row was deleted or moved',
  'sequence-gap': 'a row is missing before that point — something was deleted',
  'out-of-order': 'the entries are not in the order they were written — rows were reordered',
};

export const reasonText = (reason: string): string => REASONS[reason] ?? reason.replace(/-/g, ' ');

/** Renders a payload as a short readable line. Codes and values only; never a paragraph. */
export function payloadSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;

  if (typeof p['from'] === 'string' && typeof p['to'] === 'string') {
    return `${String(p['from'])} → ${String(p['to'])}${p['note'] ? ` — ${String(p['note'])}` : ''}`;
  }
  if (p['note']) return String(p['note']);
  return '';
}
