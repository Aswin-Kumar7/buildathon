/** Entry point for `pnpm metrics`. Writes the report at the repository root. */
import { writeReport } from './metrics.js';

const all = writeReport('../../METRICS.md');
const entities = all.reduce((sum, m) => sum + m.entities, 0);
const falsePositives = all.filter((m) => m.falsePositive).length;
const missed = all.filter((m) => m.falseNegative).length;
const escalated = all.filter((m) => m.escalated).length;

console.warn(
  `metrics — ${all.length} scenarios, ${entities} entities, ` +
    `${falsePositives} false positive(s), ${escalated} escalated, ${missed} unrecognised`,
);
