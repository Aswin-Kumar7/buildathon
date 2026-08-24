import { sql } from 'drizzle-orm';
import type { DbHandle } from '@sentinel/db';

/**
 * Idempotent DDL, applied at boot.
 *
 * Everything is created in the `sentinel` schema rather than `public`. On a managed
 * Postgres with a REST layer in front of it, `public` is published; a private schema is
 * not. Authentication tables have no business being reachable over HTTP.
 *
 * Drizzle-kit migrations take over once there is a migration history worth preserving
 * (Slice 4, when event tables arrive and data starts mattering). Until then this keeps a
 * clean clone runnable with no extra step, which is the point of the credential-free path.
 */
export async function applySchema(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`CREATE SCHEMA IF NOT EXISTS sentinel;`);

  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.role AS ENUM ('analyst', 'admin');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      display_name text NOT NULL,
      password_hash text NOT NULL,
      role sentinel.role NOT NULL DEFAULT 'analyst',
      created_at timestamptz NOT NULL DEFAULT now(),
      disabled_at timestamptz
    );
  `);

  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.sessions (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES sentinel.users(id) ON DELETE CASCADE,
      csrf_token text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sentinel.sessions (user_id);
  `);

  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.login_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      succeeded boolean NOT NULL,
      attempted_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS login_attempts_email_time_idx
      ON sentinel.login_attempts (email, attempted_at);
  `);

  // The storefront's sensor record: the request context Razorpay's webhooks never carry,
  // keyed on the order id so the payment events that arrive later can be joined to it.
  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.checkout_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      razorpay_order_id text NOT NULL UNIQUE,
      ip_pseudonym text NOT NULL,
      device_pseudonym text NOT NULL,
      email_pseudonym text,
      session_pseudonym text NOT NULL,
      user_agent_family text NOT NULL,
      amount_paise integer NOT NULL,
      currency text NOT NULL DEFAULT 'INR',
      item_count integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Every velocity question the detector asks is "this pseudonym, over this window", so
  // each correlation key is indexed together with time rather than on its own.
  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS checkout_sessions_ip_idx
      ON sentinel.checkout_sessions (ip_pseudonym, created_at);
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS checkout_sessions_session_idx
      ON sentinel.checkout_sessions (session_pseudonym, created_at);
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS checkout_sessions_device_idx
      ON sentinel.checkout_sessions (device_pseudonym, created_at);
  `);
}
