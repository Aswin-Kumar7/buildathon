/**
 * FNV-1a, 32-bit.
 *
 * The one hash the fingerprints are built on: the threshold hash, the policy hash and the
 * HyperLogLog sketch all mix their input the same way. It was written out three times before this
 * file existed, which is three places for a constant to drift.
 *
 * `fnv1a32` returns the raw signed 32-bit result of the multiply chain, exactly as the loop it
 * replaces did, so a caller that goes on to shift and xor it sees the same bits. `fnv1aHex` is the
 * unsigned, zero-padded form the fingerprints print.
 */

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

export function fnv1aHex(text: string): string {
  return (fnv1a32(text) >>> 0).toString(16).padStart(8, '0');
}
