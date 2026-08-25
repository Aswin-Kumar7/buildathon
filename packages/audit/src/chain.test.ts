import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  GENESIS_HASH,
  hashContent,
  verifyChain,
  type AuditContent,
  type ChainEntry,
} from './chain.js';

/** Builds a valid chain of `n` entries, each linked to the last. */
function build(n: number): ChainEntry[] {
  const entries: ChainEntry[] = [];
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < n; i += 1) {
    const content: AuditContent = {
      at: `2026-03-01T09:${String(i).padStart(2, '0')}:00.000Z`,
      actorId: i % 2 === 0 ? null : `user-${i}`,
      kind: 'containment.approved',
      subjectType: 'containment',
      subjectId: `c-${i}`,
      payload: { note: `step ${i}`, order: { b: 2, a: 1 } },
      policyVersion: 1,
      policyHash: 'a1b2c3d4',
      featureSnapshotHash: null,
      modelVersion: null,
      prevHash,
    };
    const hash = hashContent(content);
    entries.push({ ...content, seq: i + 1, hash });
    prevHash = hash;
  }

  return entries;
}

describe('canonicalize', () => {
  it('does not depend on the key order of the payload', () => {
    // The property the whole thing rests on: a re-serialised entry with the same values must
    // hash the same, or an untouched row would look tampered.
    const base: AuditContent = {
      at: '2026-03-01T09:00:00.000Z',
      actorId: 'a',
      kind: 'k',
      subjectType: 's',
      subjectId: '1',
      payload: { b: 2, a: 1, nested: { y: 1, x: 2 } },
      policyVersion: 1,
      policyHash: 'h',
      featureSnapshotHash: null,
      modelVersion: null,
      prevHash: GENESIS_HASH,
    };
    const reordered: AuditContent = {
      ...base,
      payload: { nested: { x: 2, y: 1 }, a: 1, b: 2 },
    };

    expect(canonicalize(base)).toBe(canonicalize(reordered));
    expect(hashContent(base)).toBe(hashContent(reordered));
  });

  it('changes when any hashed field changes', () => {
    const [entry] = build(1);
    for (const mutate of [
      { policyVersion: 2 },
      { actorId: 'someone-else' },
      { payload: { note: 'different' } },
      { modelVersion: 'v2' },
    ]) {
      expect(hashContent({ ...entry!, ...mutate })).not.toBe(entry!.hash);
    }
  });
});

describe('verifying an honest chain', () => {
  it('accepts an empty chain', () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.head).toBeNull();
  });

  it('accepts a well-formed chain and reports its head', () => {
    const chain = build(20);
    const result = verifyChain(chain);

    expect(result.valid).toBe(true);
    expect(result.entries).toBe(20);
    expect(result.head).toBe(chain[19]!.hash);
    expect(result.firstDivergence).toBeNull();
  });
});

describe('catching tampering', () => {
  it('catches a mutated row', () => {
    // The demo: deliberately corrupt a row and watch the verifier find it.
    const chain = build(10);
    chain[4] = { ...chain[4]!, payload: { note: 'quietly changed' } };

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstDivergence).toMatchObject({ seq: 5, reason: 'hash-mismatch' });
  });

  it('catches a mutation even if the hash is recomputed to match', () => {
    // A cleverer tamper: change the field AND recompute this row's hash. The link the next row
    // recorded still points at the old hash, so the break simply moves one along.
    const chain = build(10);
    const forged = { ...chain[4]!, payload: { note: 'changed' } };
    chain[4] = { ...forged, hash: hashContent(forged) };

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstDivergence).toMatchObject({ seq: 6, reason: 'broken-link' });
  });

  it('catches a deleted row', () => {
    const chain = build(10);
    chain.splice(4, 1); // remove seq 5

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    // The row that was seq 6 now follows seq 4: a gap.
    expect(result.firstDivergence).toMatchObject({ seq: 6, reason: 'sequence-gap' });
  });

  it('catches a reordered pair', () => {
    const chain = build(10);
    [chain[4], chain[5]] = [chain[5]!, chain[4]!];

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstDivergence!.reason).toMatch(/out-of-order|broken-link/);
  });

  it('catches the head being lopped off and rebuilt', () => {
    // Rewriting the tail from a point is the one thing a chain alone cannot stop without an
    // external anchor — but a *partial* rewrite that leaves an old row behind is still caught.
    const chain = build(10);
    // Re-link seq 8 onwards to a forged predecessor without fixing seq 7's hash.
    chain[7] = { ...chain[7]!, prevHash: '0'.repeat(64) };

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstDivergence).toMatchObject({ seq: 8, reason: 'broken-link' });
  });
});

describe('the first divergence is the one reported', () => {
  it('stops at the earliest break rather than listing the cascade', () => {
    const chain = build(10);
    chain[2] = { ...chain[2]!, payload: { note: 'x' } };
    chain[6] = { ...chain[6]!, payload: { note: 'y' } };

    expect(verifyChain(chain).firstDivergence!.seq).toBe(3);
  });
});
