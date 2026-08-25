#!/usr/bin/env node
/**
 * Walks the audit chain and reports the first place it stops adding up.
 *
 * The `make audit-verify` of the delivery plan, as a script the repository already has the tools
 * for. It talks to whatever database `DATABASE_URL` points at — the embedded engine has nothing
 * in it from a fresh process, so this is only meaningful against the real store the API writes
 * to. Exits non-zero on a broken chain, so it can gate a deploy or a nightly check.
 */
import { createDb } from '@sentinel/db';
import { verifyChain } from '@sentinel/audit';

const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  console.error(
    'audit:verify needs DATABASE_URL — the chain lives in the real database, and an empty ' +
      'embedded one would always verify clean and prove nothing.',
  );
  process.exit(2);
}

const handle = await createDb(url);
try {
  const rows = await handle.db.execute(
    `SELECT seq, at, actor_id, kind, subject_type, subject_id, payload,
            policy_version, policy_hash, feature_snapshot_hash, model_version, prev_hash, hash
     FROM sentinel.audit_log ORDER BY seq ASC`,
  );

  const entries = (rows.rows ?? rows).map((row) => ({
    seq: Number(row.seq),
    at: new Date(row.at).toISOString(),
    actorId: row.actor_id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    payload: row.payload,
    policyVersion: row.policy_version,
    policyHash: row.policy_hash,
    featureSnapshotHash: row.feature_snapshot_hash,
    modelVersion: row.model_version,
    prevHash: row.prev_hash,
    hash: row.hash,
  }));

  const result = verifyChain(entries);
  if (result.valid) {
    console.log(
      `audit:verify — ${result.entries} ents, chain intact (head ${result.head ?? 'empty'})`,
    );
    process.exit(0);
  }

  const d = result.firstDivergence;
  console.error(
    `audit:verify — chain BROKEN at seq ${d.seq}: ${d.reason} (${d.detail}).\n` +
      'The record has been altered. Do not trust anything at or after that sequence.',
  );
  process.exit(1);
} finally {
  await handle.close();
}
