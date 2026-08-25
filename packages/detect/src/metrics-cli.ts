/**
 * Entry point for `pnpm metrics` and `pnpm check:metrics`.
 *
 * `--check` regenerates the report in memory and compares it to the file on disk without
 * touching it. Without that, `METRICS.md` is a generated artefact that nobody regenerates: move
 * a threshold, forget to run this, and the repository carries a file making confident claims
 * about a detector that no longer exists. It is the same reason the formatter is checked rather
 * than trusted.
 */
import { readFileSync } from 'node:fs';
import { SCENARIOS } from '@sentinel/corpus';
import { measure, report, writeReport, type FamilyMetrics } from './metrics.js';

const PATH = '../../METRICS.md';

function summarise(all: readonly FamilyMetrics[]): string {
  const entities = all.reduce((sum, m) => sum + m.entities, 0);
  const falsePositives = all.filter((m) => m.falsePositive).length;
  const escalated = all.filter((m) => m.escalated).length;
  const missed = all.filter((m) => m.falseNegative).length;

  return (
    `${all.length} scenarios, ${entities} entities, ` +
    `${falsePositives} false positive(s), ${escalated} escalated, ${missed} unrecognised`
  );
}

if (process.argv.includes('--check')) {
  const all = Object.entries(SCENARIOS).map(([family, spec]) =>
    measure(family as Parameters<typeof measure>[0], spec.classification),
  );

  let current = '';
  try {
    current = readFileSync(PATH, 'utf8');
  } catch {
    console.error('check:metrics — METRICS.md is missing. Run `pnpm metrics`.');
    process.exit(1);
  }

  // Line endings are normalised because git may check the file out with CRLF on Windows while
  // the generator always writes LF. A newline difference is not a stale metric.
  const normalise = (text: string): string => text.replace(/\r\n/g, '\n');
  if (normalise(current) !== normalise(report(all))) {
    console.error(
      'check:metrics failed — METRICS.md no longer matches what the detector does.\n\n' +
        '  It is generated from the corpus and the thresholds. Something changed and it was\n' +
        '  not regenerated, so the file in the repository is making claims that are not true.\n\n' +
        'Run `pnpm metrics` and commit the result.',
    );
    process.exit(1);
  }

  console.warn(`check:metrics — up to date (${summarise(all)})`);
} else {
  console.warn(`metrics — ${summarise(writeReport(PATH))}`);
}
