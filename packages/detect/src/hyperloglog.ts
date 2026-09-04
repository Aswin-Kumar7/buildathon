/**
 * HyperLogLog: an approximate distinct count in a fixed amount of memory.
 *
 * **Candidate discovery only.** Every number this produces is an estimate with a real error
 * bound, and no decision that touches a shopper is allowed to rest on one. It exists to
 * narrow "which of ten thousand sessions might be worth looking at" down to a handful, after
 * which the exact count is re-derived from the events themselves. That split — cheap and
 * approximate to find candidates, exact and bounded to decide — is the whole reason a sketch
 * is acceptable in a system that can block someone's payment.
 *
 * Standard error is 1.04 / sqrt(2^precision): about 1.6% at precision 12, in 4 KB.
 */

import { fnv1a32 } from './fnv.js';

const PRECISION = 12;
const REGISTERS = 1 << PRECISION;

/**
 * A 32-bit hash. FNV-1a with a murmur3 finaliser.
 *
 * Not cryptographic, and it does not need to be — the only property required is that distinct
 * inputs scatter evenly. FNV-1a alone does not deliver that in its high bits for short
 * similar strings, which is exactly what identifiers are: `card_1`, `card_2`, `card_3` differ
 * in the last byte and the register index is taken from the top twelve bits. Without the
 * finaliser the sketch reported 34 distinct values for 100, because most of them landed in
 * the same registers.
 */
function hash(value: string): number {
  let h = fnv1a32(value);

  // Avalanche: spreads the influence of every input bit across all thirty-two output bits.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}

export class HyperLogLog {
  private readonly registers: Uint8Array;

  constructor(registers?: Uint8Array) {
    this.registers = registers ?? new Uint8Array(REGISTERS);
  }

  add(value: string): void {
    const h = hash(value);
    const index = h >>> (32 - PRECISION);

    // Leading-zero count of the remaining bits, plus one. A long run of zeros is rare, so
    // the longest run seen is evidence of how many distinct values went past.
    const remaining = (h << PRECISION) >>> 0;
    const rank = remaining === 0 ? 32 - PRECISION + 1 : Math.clz32(remaining) + 1;

    if (rank > this.registers[index]!) this.registers[index] = rank;
  }

  /**
   * Union of two sketches, taking the larger rank per register.
   *
   * Mergeable is why this works over minute tiles at all: a distinct count for an hour is the
   * merge of sixty sketches, without re-reading an hour of events.
   */
  merge(other: HyperLogLog): HyperLogLog {
    const merged = new Uint8Array(REGISTERS);
    for (let i = 0; i < REGISTERS; i += 1) {
      merged[i] = Math.max(this.registers[i]!, other.registers[i]!);
    }
    return new HyperLogLog(merged);
  }

  count(): number {
    let sum = 0;
    let zeros = 0;

    for (let i = 0; i < REGISTERS; i += 1) {
      const register = this.registers[i]!;
      sum += 2 ** -register;
      if (register === 0) zeros += 1;
    }

    const alpha = 0.7213 / (1 + 1.079 / REGISTERS);
    const estimate = (alpha * REGISTERS * REGISTERS) / sum;

    // Below roughly 2.5 registers the raw estimator is badly biased, and linear counting on
    // the empty registers is exact enough to use instead. Small counts are also the ones a
    // detector sees most often, so getting them wrong would matter more than the maths
    // suggests.
    if (estimate <= 2.5 * REGISTERS && zeros > 0) {
      return Math.round(REGISTERS * Math.log(REGISTERS / zeros));
    }

    return Math.round(estimate);
  }

  /** The documented standard error, so a caller can state a bound rather than imply none. */
  static get standardError(): number {
    return 1.04 / Math.sqrt(REGISTERS);
  }

  /** For persisting a tile. */
  toBytes(): Uint8Array {
    return new Uint8Array(this.registers);
  }

  static fromBytes(bytes: Uint8Array): HyperLogLog {
    if (bytes.length !== REGISTERS) throw new Error(`expected ${REGISTERS} registers`);
    return new HyperLogLog(new Uint8Array(bytes));
  }
}

/**
 * An estimate that carries its own uncertainty.
 *
 * Returned instead of a bare number so a caller cannot accidentally treat a sketch's output
 * as exact. `exact` is filled in only once the confirmation path has re-derived it.
 */
export interface DistinctEstimate {
  estimate: number;
  /** One standard error, in the same units. */
  errorBound: number;
  exact: number | null;
}

export function estimateDistinct(sketch: HyperLogLog): DistinctEstimate {
  const estimate = sketch.count();
  return {
    estimate,
    errorBound: Math.ceil(estimate * HyperLogLog.standardError),
    exact: null,
  };
}
