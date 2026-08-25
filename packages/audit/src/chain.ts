/**
 * A hash-chained, append-only record of everything the system decided or did.
 *
 * Each entry carries the hash of the one before it, so changing any past entry changes its hash,
 * which breaks the link the next entry recorded, and so on to the end. You cannot quietly edit
 * one row: to hide a change you would have to rewrite every entry after it, and the verifier
 * walks the whole chain and reports the first place the arithmetic stops adding up.
 *
 * **What this does and does not protect against.** It makes casual and accidental tampering
 * impossible to miss — a mutated field, a deleted row, a reordered pair are all caught. It does
 * *not*, on its own, stop a determined attacker with write access to the database from rewriting
 * the entire tail consistently: for that the head hash must be anchored somewhere they cannot
 * reach — signed, or published to an append-only store outside this database. That anchoring is
 * out of scope here and is stated rather than implied; the chain is the half that has to exist
 * first, and it is the half that catches everything short of a full, coordinated rewrite.
 *
 * The sequence number is deliberately **not** part of the hash. It is assigned by the database on
 * insert, so hashing it would be a chicken-and-egg problem; ordering integrity comes from the
 * `prevHash` linkage instead, and the sequence is there to detect a gap and to read the log in
 * order.
 */

import { createHash } from 'node:crypto';

/** The hash a genesis entry links back to. Fixed, so the first entry is verifiable like any other. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * The fields that are hashed — the content of an entry, minus its own hash and sequence.
 *
 * The list is exactly what the architecture calls for: the event, the decision, the policy that
 * produced it, a hash of the feature state it was computed from, the model version, who did it,
 * when, and the previous hash. `featureSnapshotHash` and `modelVersion` are nullable because not
 * every event has them — a model version only exists once there is a model — but they are part of
 * the hashed content so that when they do exist, they cannot be changed after the fact.
 */
export interface AuditContent {
  at: string;
  actorId: string | null;
  kind: string;
  subjectType: string;
  subjectId: string;
  payload: unknown;
  policyVersion: number | null;
  policyHash: string | null;
  featureSnapshotHash: string | null;
  modelVersion: string | null;
  prevHash: string;
}

/** A stored entry: hashed content, plus the sequence and hash the database holds. */
export interface ChainEntry extends AuditContent {
  seq: number;
  hash: string;
}

/**
 * A stable string form of an entry's content.
 *
 * Stable means two things: the top-level fields appear in a fixed order, and the arbitrary
 * `payload` is serialised with its object keys sorted recursively. JSON with unsorted keys would
 * hash differently depending on insertion order, which would make a re-serialised-but-unchanged
 * entry look tampered. This is the one place where "canonical" has to be exactly, boringly true.
 */
export function canonicalize(content: AuditContent): string {
  return JSON.stringify([
    content.at,
    content.actorId,
    content.kind,
    content.subjectType,
    content.subjectId,
    stableStringify(content.payload),
    content.policyVersion,
    content.policyHash,
    content.featureSnapshotHash,
    content.modelVersion,
    content.prevHash,
  ]);
}

export function hashContent(content: AuditContent): string {
  return createHash('sha256').update(canonicalize(content)).digest('hex');
}

/** Why the chain does not add up, at the first place it does not. */
export type DivergenceReason =
  | 'hash-mismatch' // a field was changed — the recorded hash no longer matches the content
  | 'broken-link' // this entry's prevHash is not the previous entry's hash — a deletion or reorder
  | 'sequence-gap' // a sequence number is missing — a row was deleted
  | 'out-of-order'; // sequence numbers do not increase — rows were reordered

export interface Divergence {
  seq: number;
  reason: DivergenceReason;
  detail: string;
}

export interface VerifyResult {
  valid: boolean;
  entries: number;
  /** The head hash, which is what an external anchor would pin. Null for an empty chain. */
  head: string | null;
  firstDivergence: Divergence | null;
}

/**
 * Walks the chain in the order given and reports the first place it stops being consistent.
 *
 * Entries must arrive ordered by sequence — that is how the database returns them, and checking
 * that they actually are ordered is itself one of the things this catches. The walk returns at
 * the first divergence rather than collecting them all, because after the first break every
 * downstream hash is expected to be wrong and listing them would bury the one that matters.
 */
export function verifyChain(entries: readonly ChainEntry[]): VerifyResult {
  let previous: ChainEntry | null = null;

  for (const entry of entries) {
    // Ordering first: a reorder shows up here before its hashes are even considered.
    if (previous !== null) {
      if (entry.seq <= previous.seq) {
        return divergence(
          entries,
          entry.seq,
          'out-of-order',
          `sequence ${entry.seq} follows ${previous.seq}`,
        );
      }
      if (entry.seq !== previous.seq + 1) {
        return divergence(
          entries,
          entry.seq,
          'sequence-gap',
          `sequence jumps from ${previous.seq} to ${entry.seq}`,
        );
      }
    }

    // The link to the entry before it. A deleted or moved predecessor breaks this.
    const expectedPrev = previous === null ? GENESIS_HASH : previous.hash;
    if (entry.prevHash !== expectedPrev) {
      return divergence(
        entries,
        entry.seq,
        'broken-link',
        'prevHash does not match the entry before it',
      );
    }

    // The content itself. Any changed field changes this.
    if (hashContent(entry) !== entry.hash) {
      return divergence(
        entries,
        entry.seq,
        'hash-mismatch',
        'the recorded hash does not match the content',
      );
    }

    previous = entry;
  }

  return {
    valid: true,
    entries: entries.length,
    head: previous === null ? null : previous.hash,
    firstDivergence: null,
  };
}

function divergence(
  entries: readonly ChainEntry[],
  seq: number,
  reason: DivergenceReason,
  detail: string,
): VerifyResult {
  return {
    valid: false,
    entries: entries.length,
    head: entries.length === 0 ? null : entries[entries.length - 1]!.hash,
    firstDivergence: { seq, reason, detail },
  };
}

/** Recursively key-sorted structure, so JSON serialisation is order-independent. */
function stableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableStringify);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = stableStringify((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
