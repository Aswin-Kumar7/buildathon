import { sql } from 'drizzle-orm';
import type { DbHandle } from '@sentinel/db';

/**
 * Idempotent DDL, applied at boot.
 *
 * Everything is created in the `sentinel` schema rather than `public`. On a managed
 * Postgres with a REST layer in front of it, `public` is published; a private schema is
 * not. Authentication tables have no business being reachable over HTTP.
 *
 * The limitation to know about: `CREATE TABLE IF NOT EXISTS` never alters a table that
 * already exists. Adding a column here does nothing to a database created before it, and
 * the failure appears at query time rather than at boot. That is survivable while the
 * schema only grows and every environment can be recreated; it stops being survivable the
 * first time a column changes type or is dropped, which is when drizzle-kit migrations
 * have to take over.
 *
 * Until then this keeps a clean clone runnable with no extra step, which is the point of
 * the credential-free path.
 *
 * Split by concern rather than left as one long function: each group is independently
 * readable, and a failure names which part of the schema could not be created.
 */
export async function applySchema(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`CREATE SCHEMA IF NOT EXISTS sentinel;`);
  await createAuthTables(handle);
  await createTelemetryTables(handle);
  await createIngestionTables(handle);
}

async function createAuthTables(handle: DbHandle): Promise<void> {
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
}

async function createTelemetryTables(handle: DbHandle): Promise<void> {
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

async function createIngestionTables(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.inbox_status AS ENUM ('pending', 'processed', 'dead');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // The transactional inbox. The unique constraint on razorpay_event_id is the whole
  // deduplication guarantee: at-least-once delivery cannot become two rows.
  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.inbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      razorpay_event_id text NOT NULL UNIQUE,
      event_type text NOT NULL,
      ciphertext text,
      iv text,
      auth_tag text,
      wrapped_key text,
      wrapped_key_iv text,
      wrapped_key_tag text,
      key_version integer,
      event_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      late boolean NOT NULL DEFAULT false,
      delivery_count integer NOT NULL DEFAULT 1,
      last_delivered_at timestamptz NOT NULL DEFAULT now(),
      status sentinel.inbox_status NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      processed_at timestamptz,
      purged_at timestamptz
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS inbox_events_status_idx
      ON sentinel.inbox_events (status, received_at);
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS inbox_events_event_at_idx ON sentinel.inbox_events (event_at);
  `);

  await createCanonicalEventTable(handle);
}

// The redacted canonical event. Nothing downstream reads the inbox directly, so no
// customer-associated field can reach a feature, a decision or a prompt by accident.
async function createCanonicalEventTable(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.canonical_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      inbox_event_id uuid NOT NULL UNIQUE
        REFERENCES sentinel.inbox_events(id) ON DELETE CASCADE,
      razorpay_event_id text NOT NULL UNIQUE,
      event_type text NOT NULL,
      entity_type text,
      razorpay_order_id text,
      razorpay_payment_id text,
      amount_paise integer,
      currency text,
      status text,
      method text,
      error_code text,
      error_reason text,
      error_source text,
      error_step text,
      error_description text,
      card_network text,
      card_type text,
      card_issuer text,
      card_id text,
      international boolean,
      event_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL,
      late boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS canonical_events_order_idx
      ON sentinel.canonical_events (razorpay_order_id, event_at);
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS canonical_events_payment_idx
      ON sentinel.canonical_events (razorpay_payment_id);
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS canonical_events_type_time_idx
      ON sentinel.canonical_events (event_type, event_at);
  `);
}
