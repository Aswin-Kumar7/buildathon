const STORAGE_KEY = 'sentinel.storefront.session';

/**
 * A first-party session identifier, minted here and kept for the tab's lifetime.
 *
 * This is the storefront's own notion of "the same visitor doing several things", and it
 * is one of the few correlation signals Razorpay's webhooks cannot provide. It is a random
 * value with no meaning — never an email, never anything derived from the person — and the
 * server only ever stores a keyed hash of it.
 *
 * sessionStorage rather than localStorage: it should expire with the tab rather than
 * following someone across visits.
 */
export function getClientSessionId(): string {
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (existing !== null && existing.length >= 8) return existing;

  const fresh = crypto.randomUUID();
  sessionStorage.setItem(STORAGE_KEY, fresh);
  return fresh;
}

export function resetClientSessionId(): string {
  sessionStorage.removeItem(STORAGE_KEY);
  return getClientSessionId();
}
