import { boolean, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/**
 * The sensor's record.
 *
 * Razorpay's payment webhooks carry no IP, no device and no user-agent, so a detector that
 * listens only to webhooks cannot express "many attempts from one place". This table is
 * where that context is captured, at order-creation time, keyed on the Razorpay order id
 * so the two streams can be joined later.
 *
 * Nothing here is a payment outcome. These are *checkout* events — session behaviour
 * observed by the merchant. Only Razorpay may tell us what a bank decided.
 */
export const checkoutSessions = sentinel.table(
  'checkout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    razorpayOrderId: text('razorpay_order_id').notNull().unique(),

    // Keyed HMAC pseudonyms, version-prefixed. Never raw values.
    ipPseudonym: text('ip_pseudonym').notNull(),
    devicePseudonym: text('device_pseudonym').notNull(),
    emailPseudonym: text('email_pseudonym'),
    sessionPseudonym: text('session_pseudonym').notNull(),

    userAgentFamily: text('user_agent_family').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    itemCount: integer('item_count').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('checkout_sessions_ip_idx').on(table.ipPseudonym, table.createdAt),
    index('checkout_sessions_session_idx').on(table.sessionPseudonym, table.createdAt),
    index('checkout_sessions_device_idx').on(table.devicePseudonym, table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type CheckoutSession = typeof checkoutSessions.$inferSelect;

export const inboxStatusEnum = sentinel.enum('inbox_status', ['pending', 'processed', 'dead']);

/**
 * The transactional inbox. Every webhook Razorpay delivers lands here, encrypted, before
 * we acknowledge it.
 *
 * The ordering matters more than it looks. Acknowledging first and persisting after means
 * a process that dies in between loses the event permanently — Razorpay has already had
 * its 2xx and will never retry. So: verify, insert, commit, *then* answer.
 *
 * `razorpayEventId` is the deduplication key and carries a unique constraint, which is
 * what makes at-least-once delivery safe: the second copy of an event cannot become a
 * second row, whatever the worker or the network does.
 */
export const inboxEvents = sentinel.table(
  'inbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * From the `X-Razorpay-Event-Id` header. The payload body has no event identifier of
     * its own, so when the header is absent we fall back to a hash of the raw bytes —
     * still stable across redeliveries of the same event.
     */
    razorpayEventId: text('razorpay_event_id').notNull().unique(),
    eventType: text('event_type').notNull(),

    // Envelope-encrypted raw body. A database dump on its own decrypts to nothing: the
    // key that unwraps these rows lives in the environment, not in the database.
    ciphertext: text('ciphertext'),
    iv: text('iv'),
    authTag: text('auth_tag'),
    wrappedKey: text('wrapped_key'),
    wrappedKeyIv: text('wrapped_key_iv'),
    wrappedKeyTag: text('wrapped_key_tag'),
    keyVersion: integer('key_version'),

    /** Razorpay's `created_at`. All windowing uses this, never arrival time. */
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Beyond the allowed-lateness bound when it arrived. Recorded and counted; it may
     * correct analytics but never silently rewrites a decision already taken.
     */
    late: boolean('late').notNull().default(false),

    /**
     * How many times Razorpay has delivered this event. Redeliveries increment it rather
     * than creating a row, which is both the deduplication guarantee and the only honest
     * way to report a duplicate rate.
     */
    deliveryCount: integer('delivery_count').notNull().default(1),
    lastDeliveredAt: timestamp('last_delivered_at', { withTimezone: true }).notNull().defaultNow(),

    status: inboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    /** Set when the ciphertext is dropped at the end of the forensic retention window. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (table) => [
    index('inbox_events_status_idx').on(table.status, table.receivedAt),
    index('inbox_events_event_at_idx').on(table.eventAt),
  ],
);
export type InboxEvent = typeof inboxEvents.$inferSelect;

/**
 * The redacted canonical event — the only representation anything downstream is allowed
 * to read. Features, detection, policy, the console, narration, fixtures and exports all
 * come through here.
 *
 * What is deliberately absent: email, contact number, card last four, VPA, cardholder
 * name. Those live only inside the encrypted blob on the inbox row, for a short forensic
 * window. Keeping the split at the schema level means a downstream query cannot reach
 * customer data even by accident.
 */
export const canonicalEvents = sentinel.table(
  'canonical_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inboxEventId: uuid('inbox_event_id')
      .notNull()
      .unique()
      .references(() => inboxEvents.id, { onDelete: 'cascade' }),
    razorpayEventId: text('razorpay_event_id').notNull().unique(),

    eventType: text('event_type').notNull(),
    entityType: text('entity_type'),

    razorpayOrderId: text('razorpay_order_id'),
    razorpayPaymentId: text('razorpay_payment_id'),

    amountPaise: integer('amount_paise'),
    currency: text('currency'),
    status: text('status'),
    method: text('method'),

    // Razorpay's own failure vocabulary. This is the detector's richest signal on a
    // declined attempt, and none of it identifies a person.
    errorCode: text('error_code'),
    errorReason: text('error_reason'),
    errorSource: text('error_source'),
    errorStep: text('error_step'),
    errorDescription: text('error_description'),

    /**
     * Coarse card attributes only. Razorpay never exposes the BIN to a merchant, so a
     * per-BIN velocity signal is not available at any price — the issuer cohort and
     * distinct card counts are the honest substitutes.
     */
    cardNetwork: text('card_network'),
    cardType: text('card_type'),
    cardIssuer: text('card_issuer'),
    cardId: text('card_id'),
    international: boolean('international'),

    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    late: boolean('late').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('canonical_events_order_idx').on(table.razorpayOrderId, table.eventAt),
    index('canonical_events_payment_idx').on(table.razorpayPaymentId),
    index('canonical_events_type_time_idx').on(table.eventType, table.eventAt),
  ],
);
export type CanonicalEvent = typeof canonicalEvents.$inferSelect;
