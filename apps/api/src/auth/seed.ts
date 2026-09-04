import type { AuthService } from './auth.service.js';

/**
 * Demo reviewers, created at boot outside production.
 *
 * These credentials are intentionally public and the accounts exist purely so a reviewer
 * can sign in to a local instance. Nothing here is a secret, and nothing here should ever
 * exist in production — that seeding is a separate, deliberate operation.
 */
export const DEMO_USERS = [
  {
    email: 'analyst@sentinel.local',
    displayName: 'Demo Analyst',
    password: 'sentinel-demo',
    // Admin, despite the name: this is the account a reviewer signs in with, and every control on
    // the console — the kill switch included — should be reachable from it without a second login.
    role: 'admin' as const,
  },
  {
    email: 'admin@sentinel.local',
    displayName: 'Demo Admin',
    password: 'sentinel-demo',
    role: 'admin' as const,
  },
];

/**
 * Idempotent per email rather than skipped when the table is non-empty.
 *
 * The earlier "seed only into an empty table" rule looked safe and was not: one unrelated
 * row is enough to disable seeding forever, and that is exactly what happened when a test
 * run wrote its fixture users into the shared database. Sign-in then failed with
 * "Email or password is incorrect" — an answer that gives no hint the account was never
 * created. Inserting each account on its own conflict clause has no such failure mode.
 *
 * Whether to call this at all is the caller's decision, governed by SEED_DEMO_USERS. One
 * control point rather than two: a guard here *and* a flag there means reasoning about
 * which one is in force, and the answer would be wrong exactly once.
 */
export async function seedDemoUsers(auth: AuthService): Promise<void> {
  for (const user of DEMO_USERS) {
    await auth.createUser(user);
  }
}
