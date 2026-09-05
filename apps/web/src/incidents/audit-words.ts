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
  'recommendation.accepted': 'AI recommendation accepted',
  'recommendation.rejected': 'AI recommendation declined',
  // Policy governance, appended by the policy workflow.
  'policy.draft_created': 'Policy draft created',
  'policy.submitted': 'Policy submitted',
  'policy.approved': 'Policy approved',
  'policy.rejected': 'Policy rejected',
  'policy.published': 'Policy saved',
  'policy.reverted': 'Policy reverted',
  // The operator emergency stop.
  // "Enforcement paused/resumed" named an internal flag. What the kill switch actually does is stop
  // Sentinel acting at all and release every live block, so the log says that instead.
  'enforcement.paused': 'Protection stopped',
  'enforcement.resumed': 'Protection resumed',
};

export const kindLabel = (kind: string): string => KINDS[kind] ?? kind.replace(/[._]/g, ' ');

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
};
/** An audit timestamp (epoch ms) as a person reads it. */
export const fmtDateTime = (ms: number): string => new Date(ms).toLocaleString('en-IN', DATE_TIME);

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

  // An AI recommendation entry: the action and how it aligned, both bound codes from the backend.
  if (typeof p['action'] === 'string' && typeof p['alignment'] === 'string') {
    const note = p['note'] ? ` — ${String(p['note'])}` : '';
    return `Recommended ${String(p['action'])} · ${String(p['alignment'])}${note}`;
  }
  if (typeof p['from'] === 'string' && typeof p['to'] === 'string') {
    return `${String(p['from'])} → ${String(p['to'])}${p['note'] ? ` — ${String(p['note'])}` : ''}`;
  }
  if (p['note']) return String(p['note']);
  // Enforcement pause/resume carry only a free-text reason.
  if (typeof p['reason'] === 'string') return String(p['reason']);
  return '';
}
