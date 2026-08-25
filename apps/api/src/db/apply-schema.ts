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
  await createTypes(handle);
  await createAuthTables(handle);
  await createTelemetryTables(handle);
  await createIngestionTables(handle);
  await createIncidentTables(handle);
  await createContainmentTables(handle);
}

/**
 * Every enum, before any table that might reference one.
 *
 * They used to be declared beside the tables that introduced them, which worked until
 * `checkout_sessions` needed `event_source` — a type created two functions later. The failure
 * was `type "sentinel.event_source" does not exist` on a fresh database only, so it passed
 * everywhere the schema already existed.
 */
async function createTypes(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.role AS ENUM ('analyst', 'admin');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.inbox_status AS ENUM ('pending', 'processed', 'dead');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.event_source AS ENUM ('razorpay', 'replay');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.incident_status AS ENUM
        ('open', 'under_review', 'contained', 'resolved', 'expired');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.incident_severity AS ENUM ('low', 'medium', 'high');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await handle.db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE sentinel.containment_status AS ENUM
        ('proposed', 'active', 'rejected', 'expired', 'released');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

/**
 * What was done about an incident, and every hand that touched it.
 *
 * The events table is append-only: the sequence is the record, and the slice's exit condition is
 * that a containment can be proposed, approved, applied and expire with every step attributable.
 */
async function createContainmentTables(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.containments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id uuid NOT NULL REFERENCES sentinel.incidents(id) ON DELETE CASCADE,
      entity_kind text NOT NULL,
      entity_key text NOT NULL,
      action text NOT NULL,
      status sentinel.containment_status NOT NULL DEFAULT 'proposed',
      approvals_required integer NOT NULL DEFAULT 1,
      decision jsonb NOT NULL,
      policy_version integer NOT NULL,
      policy_hash text NOT NULL,
      proposed_by uuid REFERENCES sentinel.users(id) ON DELETE SET NULL,
      proposed_at timestamptz NOT NULL DEFAULT now(),
      activated_at timestamptz,
      expires_at timestamptz,
      ended_at timestamptz,
      extensions integer NOT NULL DEFAULT 0
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS containments_incident_idx
      ON sentinel.containments (incident_id);
  `);
  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS containments_status_idx
      ON sentinel.containments (status, expires_at);
  `);
  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS containments_entity_idx
      ON sentinel.containments (entity_kind, entity_key);
  `);

  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.containment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      containment_id uuid NOT NULL REFERENCES sentinel.containments(id) ON DELETE CASCADE,
      kind text NOT NULL,
      actor_id uuid REFERENCES sentinel.users(id) ON DELETE SET NULL,
      note text,
      at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS containment_events_containment_idx
      ON sentinel.containment_events (containment_id, at);
  `);
}

/**
 * Incidents, and the record of every hand that moved one.
 *
 * `key` is unique so re-evaluating a burst updates the episode rather than adding another row
 * for the same thing. The transitions table is append-only: "contained" and "resolved" are
 * claims about what somebody did, and a history that could be rewritten could not answer why
 * an incident was closed.
 */
async function createIncidentTables(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      entity_kind text NOT NULL,
      entity_key text NOT NULL,
      status sentinel.incident_status NOT NULL DEFAULT 'open',
      severity sentinel.incident_severity NOT NULL,
      score double precision NOT NULL,
      score_lower double precision NOT NULL,
      score_upper double precision NOT NULL,
      band text NOT NULL,
      evidence jsonb NOT NULL,
      abstentions jsonb NOT NULL,
      change jsonb,
      arbitration jsonb,
      source sentinel.event_source NOT NULL DEFAULT 'razorpay',
      first_attempt_at timestamptz NOT NULL,
      detected_at timestamptz NOT NULL,
      last_activity_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      observations integer NOT NULL DEFAULT 1,
      threshold_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Added after the table existed, so an existing database gains it rather than needing a drop.
  await handle.db.execute(sql`
    ALTER TABLE sentinel.incidents ADD COLUMN IF NOT EXISTS arbitration jsonb;
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS incidents_status_idx
      ON sentinel.incidents (status, detected_at);
  `);
  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS incidents_entity_idx
      ON sentinel.incidents (entity_kind, entity_key);
  `);
  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS incidents_severity_idx
      ON sentinel.incidents (severity, detected_at);
  `);

  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.incident_transitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id uuid NOT NULL REFERENCES sentinel.incidents(id) ON DELETE CASCADE,
      from_status sentinel.incident_status NOT NULL,
      to_status sentinel.incident_status NOT NULL,
      actor_id uuid REFERENCES sentinel.users(id) ON DELETE SET NULL,
      note text,
      at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await handle.db.execute(sql`
    CREATE INDEX IF NOT EXISTS incident_transitions_incident_idx
      ON sentinel.incident_transitions (incident_id, at);
  `);
}

async function createAuthTables(handle: DbHandle): Promise<void> {
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
      source sentinel.event_source NOT NULL DEFAULT 'razorpay',
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
  // The transactional inbox. The unique constraint on razorpay_event_id is the whole
  // deduplication guarantee: at-least-once delivery cannot become two rows.
  await handle.db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentinel.inbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      razorpay_event_id text NOT NULL UNIQUE,
      event_type text NOT NULL,
      source sentinel.event_source NOT NULL DEFAULT 'razorpay',
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
  await addSourceColumns(handle);
}

/**
 * `CREATE TABLE IF NOT EXISTS` never alters a table that already exists, so a column added
 * after a deployment has been running needs saying separately. `ADD COLUMN IF NOT EXISTS` is
 * idempotent and safe to run on every boot; the day a column needs its type changed instead,
 * drizzle-kit migrations have to take over.
 */
async function addSourceColumns(handle: DbHandle): Promise<void> {
  for (const table of ['inbox_events', 'canonical_events', 'checkout_sessions']) {
    await handle.db.execute(
      sql.raw(
        `ALTER TABLE sentinel.${table} ADD COLUMN IF NOT EXISTS source sentinel.event_source NOT NULL DEFAULT 'razorpay';`,
      ),
    );
  }
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
      source sentinel.event_source NOT NULL DEFAULT 'razorpay',
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
