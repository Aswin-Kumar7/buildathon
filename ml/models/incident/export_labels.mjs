// Exports confirmed merchant labels to `data/merchant_labels.csv`, the retraining seam.
//
// Every incident an analyst confirmed (or a chargeback settled) carries the exact feature vector the
// decision was made on and a label — 1 for real abuse, 0 for a false alarm. This reads those out in
// the same feature columns the synthetic corpus uses, so `make eval` can train on real outcomes
// alongside the cold-start corpus with no other change (see incident/data.py).
//
// Only real (razorpay) traffic counts, for the same reason it does everywhere else in this system: a
// replayed scenario is not evidence the detector works, and a confirmed replay is not a real label.
// Set INCLUDE_REPLAY=1 to include replayed incidents when exercising the plumbing on the demo path.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDb } from '@sentinel/db';
import { INCIDENT_FEATURE_NAMES } from '@sentinel/detect';

const HERE = dirname(fileURLToPath(import.meta.url));
const includeReplay = process.env.INCLUDE_REPLAY === '1';

const handle = await createDb(process.env.DATABASE_URL);
try {
  const result = await handle.db.execute(sql`
    SELECT id, features, label, source
    FROM sentinel.incidents
    WHERE label IS NOT NULL AND features IS NOT NULL
      AND (${includeReplay} OR source = 'razorpay')
  `);
  // drizzle returns the rows array for postgres-js and a { rows } object for pglite.
  const rows = Array.isArray(result) ? result : (result.rows ?? []);

  const header = [...INCIDENT_FEATURE_NAMES, 'is_abuse', 'group', 'origin'];
  const lines = [header.join(',')];
  let written = 0;
  for (const row of rows) {
    const features = typeof row.features === 'string' ? JSON.parse(row.features) : row.features;
    if (features === null || features === undefined) continue;
    const values = INCIDENT_FEATURE_NAMES.map((name) => {
      const v = features[name];
      return typeof v === 'number' ? Number(v.toFixed(6)) : 0;
    });
    // Each confirmed incident is its own split group, so no entity straddles train and test.
    lines.push([...values, Number(row.label), `merchant_${row.id}`, 'merchant'].join(','));
    written += 1;
  }

  mkdirSync(join(HERE, 'data'), { recursive: true });
  const out = join(HERE, 'data', 'merchant_labels.csv');
  if (written === 0) {
    console.log(
      'export-labels — no confirmed real labels yet. The capture is live; this file fills as ' +
        'analysts confirm incidents on real traffic. Nothing written.',
    );
  } else {
    writeFileSync(out, lines.join('\n') + '\n', 'utf8');
    console.log(`export-labels — wrote ${written} confirmed merchant labels to ${out}`);
  }
} finally {
  await handle.close();
}
