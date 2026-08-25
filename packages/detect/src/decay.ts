/**
 * Half-life decay.
 *
 * `f(t2) = f(t1) / 2^((t2 - t1) / halfLife)` — the standard formula, and the reason it is
 * used rather than a sliding window is that a window has a cliff. An attack that stops
 * ninety seconds before a two-minute window closes is invisible the moment the window rolls
 * past it, and a threshold sitting near the edge flickers as events age out one at a time.
 * Decay makes recency continuous: nothing changes state because a clock ticked.
 *
 * It also makes a counter mergeable across time, which is what lets minute tiles be summed
 * instead of every event being re-read.
 */
export function decayFactor(ageMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) throw new Error('half-life must be positive');
  if (ageMs <= 0) return 1;
  return 2 ** (-ageMs / halfLifeMs);
}

/** Ages a counter forward from when it was last touched to now. */
export function decayed(value: number, ageMs: number, halfLifeMs: number): number {
  return value * decayFactor(ageMs, halfLifeMs);
}

/**
 * A decayed count over a set of timestamps, evaluated at one moment.
 *
 * Events after `asOf` are ignored rather than counted or clamped. A feature computed for a
 * decision must not see anything that had not happened when the decision was taken —
 * otherwise a replay of that decision would use information the original never had, and the
 * reproduction would silently be of a different question.
 */
export function decayedCount(
  timestamps: readonly number[],
  asOf: number,
  halfLifeMs: number,
): number {
  let total = 0;
  for (const at of timestamps) {
    if (at > asOf) continue;
    total += decayFactor(asOf - at, halfLifeMs);
  }
  return total;
}

/** Minutes to milliseconds, for readability at call sites. */
export const minutes = (n: number): number => n * 60_000;
