#!/usr/bin/env node
/**
 * Fails if any staged file is oversized or sits under a restricted data path.
 *
 * The IEEE-CIS competition rules forbid redistributing the dataset, and a public
 * repository makes anything committed available to non-participants. This guard is
 * what actually prevents that, rather than a line in a README.
 */
import { execSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';

const MAX_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_PREFIXES = ['data/raw/', 'data/interim/'];
const ALLOWED_LARGE = [/^fixtures\//];

let staged = [];
try {
  staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
} catch {
  console.warn('check:data — not a git repository yet, skipping');
  process.exit(0);
}

const problems = [];
for (const file of staged) {
  if (FORBIDDEN_PREFIXES.some((p) => file.startsWith(p))) {
    problems.push(`${file} — restricted data path`);
    continue;
  }
  if (!existsSync(file)) continue;
  const { size } = statSync(file);
  if (size > MAX_BYTES && !ALLOWED_LARGE.some((re) => re.test(file))) {
    problems.push(`${file} — ${(size / 1024 / 1024).toFixed(1)} MB exceeds the 10 MB limit`);
  }
}

if (problems.length > 0) {
  console.error('check:data failed\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nCommit a download script and a checksum instead of the data.');
  process.exit(1);
}

console.warn(`check:data — ${staged.length} staged file(s) ok`);
