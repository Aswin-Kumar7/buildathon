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
const SCAN_EXTENSIONS = new Set([
  '.json',
  '.ndjson',
  '.jsonl',
  '.log',
  '.txt',
  '.csv',
  '.md',
  '.zip',
]);
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
  { name: 'a card number', pattern: /\b(?:\d[ -]?){13,19}\b/ },
];

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
    for (const { name, pattern } of FORBIDDEN_VALUES) {
      const global = new RegExp(pattern.source, 'g');
      for (const match of content.matchAll(global)) {
        if (ALLOWED_DOMAINS.some((domain) => match[0].endsWith(domain))) continue;
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
