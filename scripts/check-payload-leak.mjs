#!/usr/bin/env node
/**
 * Fails if a raw Razorpay payload has escaped into somewhere it can be read.
 *
 * The architecture makes one promise about customer data: it exists encrypted on an inbox
 * row for a short forensic window, and nowhere else. Everything downstream reads the
 * redacted canonical event. That promise is easy to state and easy to break by accident —
 * a debug log, a captured fixture, a Playwright trace — so it is checked rather than
 * trusted.
 *
 * Scans data and output directories, not source. `apps/api/src/webhooks/fixtures.ts`
 * contains these field names on purpose: a redactor is only worth testing against a
 * payload that actually holds something worth redacting.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const SCAN_DIRS = [
  'fixtures',
  'logs',
  'data',
  'test-results',
  'playwright-report',
  'ml/corpus/out',
];
const SCAN_EXTENSIONS = new Set(['.json', '.ndjson', '.jsonl', '.log', '.txt', '.csv', '.md']);

/**
 * `.zip` is deliberately absent.
 *
 * A Playwright trace is a zip, and reading one as UTF-8 and running a regex over it is worse
 * than not checking: the entries are deflated, so real content is invisible, while the
 * uncompressed filename table matches everything. It reported `page@<hash>-<ms>.jpeg` as an
 * email address and a millisecond timestamp as a card number, failing the gate on every run
 * that retained a trace. A check that cries wolf gets ignored, which is how the real one gets
 * missed. Traces are gitignored and produced only on failure; the text artefacts beside them
 * — `error-context.md` and the JSON reports — are scanned, and those are where a payload
 * would actually be legible.
 */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Field names from a Razorpay payment payload that identify a person, plus value shapes
 * that identify one regardless of the key they arrive under.
 */
const FORBIDDEN_KEYS = [
  '"email"',
  '"contact"',
  '"last4"',
  '"vpa"',
  '"card_holder_name"',
  '"customer_id"',
  '"bank_transaction_id"',
];

/**
 * Domains that are ours and deliberately fake. The demo accounts are printed on the login
 * page on purpose — a reviewer has to be able to sign in to a fresh clone — so finding one
 * in a test artefact is not a leak, and flagging it would train everyone to ignore this
 * check.
 */
const ALLOWED_DOMAINS = ['@sentinel.local', '@test.local', '@example.com', '@example.local'];

const FORBIDDEN_VALUES = [
  { name: 'an email address', pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { name: 'an Indian phone number', pattern: /\+91\d{10}/ },
  // Confirmed by checksum rather than by shape. Any 13-to-19 digit run looks like a card,
  // including every millisecond timestamp ever written to a log, and a check that fires on
  // those teaches everyone to skip past it.
  { name: 'a card number', pattern: /\b(?:\d[ -]?){13,19}\b/, confirm: luhn },
];

/** The checksum every real card number satisfies and almost no other digit run does. */
function luhn(candidate) {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      yield* walk(path);
    } else if (SCAN_EXTENSIONS.has(extname(entry)) && stats.size <= MAX_BYTES) {
      yield path;
    }
  }
}

const problems = [];
let scanned = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    scanned += 1;
    const content = readFileSync(file, 'utf8');

    for (const key of FORBIDDEN_KEYS) {
      if (content.includes(key)) problems.push(`${file} — contains the payload field ${key}`);
    }
    for (const { name, pattern, confirm } of FORBIDDEN_VALUES) {
      const global = new RegExp(pattern.source, 'g');
      for (const match of content.matchAll(global)) {
        if (ALLOWED_DOMAINS.some((domain) => match[0].endsWith(domain))) continue;
        if (confirm !== undefined && !confirm(match[0])) continue;
        // The match itself is never printed: a leak report that quotes the leak is a leak.
        problems.push(`${file} — contains something shaped like ${name}`);
        break;
      }
    }
  }
}

if (problems.length > 0) {
  console.error('check:payload failed — customer data has reached a readable file\n');
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  console.error('\nThe raw payload belongs only in the encrypted inbox column.');
  process.exit(1);
}

console.warn(`check:payload — ${scanned} file(s) scanned, no payload data found`);
