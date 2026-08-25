/**
 * A seeded pseudo-random generator.
 *
 * `Math.random` cannot be seeded, and a corpus that cannot be regenerated identically is a
 * corpus nobody can check. Every number in a scenario comes from here, so a family plus a
 * seed reproduces the same events byte for byte on any machine — which is what lets the
 * scenario definitions be committed before any tuning and still mean something afterwards.
 *
 * mulberry32: thirty-two bits of state, uniform enough for traffic shapes, and short enough
 * to read. Not for anything that needs to be unguessable — nothing here does.
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Everything a scenario needs to draw from, all fed by one seed. */
export class Draw {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = seeded(seed);
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('cannot pick from an empty list');
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Fisher-Yates on a copy. Shuffling in place would mutate a caller's array, and a
   * generator that quietly rearranges its inputs is a generator whose output depends on
   * call order.
   */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /**
   * A gap between events, drawn from an exponential distribution.
   *
   * Real arrivals cluster; uniform gaps produce a metronome that no burst detector would
   * ever have to work for. An exponential inter-arrival time is the standard model for
   * independent events and gives the bunching a real minute has.
   */
  gapSeconds(meanSeconds: number): number {
    return -Math.log(1 - this.next()) * meanSeconds;
  }

  /** A synthetic identifier. Deliberately unlike anything Razorpay issues. */
  id(prefix: string, length = 14): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[this.int(0, alphabet.length - 1)];
    return `${prefix}_SIM${out}`;
  }
}
