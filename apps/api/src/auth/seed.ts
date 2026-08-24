import type { AuthService } from './auth.service.js';

/**
 * Demo reviewers, created only when the user table is empty.
 *
 * These credentials are intentionally public and the accounts exist purely so a
 * reviewer can sign in to a local instance. Nothing here is a secret, and nothing
 * here should ever exist outside development — production seeding is a separate,
 * deliberate operation.
 */
export const DEMO_USERS = [
  {
    email: 'analyst@sentinel.local',
    displayName: 'Demo Analyst',
    password: 'sentinel-demo',
    role: 'analyst' as const,
  },
  {
    email: 'admin@sentinel.local',
    displayName: 'Demo Admin',
    password: 'sentinel-demo',
    role: 'admin' as const,
  },
];

export async function seedDemoUsers(auth: AuthService): Promise<void> {
  if ((await auth.countUsers()) > 0) return;
  for (const user of DEMO_USERS) {
    await auth.createUser(user);
  }
  console.warn(`seeded ${DEMO_USERS.length} demo users`);
}
