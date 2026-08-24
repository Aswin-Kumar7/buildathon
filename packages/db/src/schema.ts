import { boolean, index, pgSchema, timestamp, uuid, text } from 'drizzle-orm/pg-core';

/**
 * Everything lives in a dedicated `sentinel` schema, never `public`.
 *
 * Supabase exposes the `public` schema through PostgREST, so a table created there is
 * reachable over HTTPS by anyone holding the anon key. Row-level security would gate the
 * rows, but publishing an authentication table's shape to the internet is attack surface
 * we have no reason to create. A schema that is not in the exposed list is simply absent
 * from the Data API.
 */
export const sentinel = pgSchema('sentinel');

export const roleEnum = sentinel.enum('role', ['analyst', 'admin']);

/**
 * Reviewers. The audit chain records an actor for every approval, so an identity is
 * load-bearing rather than decorative — an approval with nobody attached to it is not
 * an approval.
 */
export const users = sentinel.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('analyst'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

/**
 * The primary key is the SHA-256 of the session token, never the token itself, so a
 * database dump does not hand over usable sessions. The raw token lives only in the
 * client's httpOnly cookie.
 */
export const sessions = sentinel.table(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** Login attempts are persisted so the rate limit survives a restart. */
export const loginAttempts = sentinel.table(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_attempts_email_time_idx').on(table.email, table.attemptedAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
