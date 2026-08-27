import { z } from 'zod';

/**
 * Booleans from the environment are always strings, and `z.coerce.boolean()` reads every
 * non-empty one as true — including "false". Parsing from an explicit set means a typo is
 * rejected at startup rather than silently becoming `true`.
 */
const envBoolean = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((value) => value === 'true' || value === '1');

/** Same parsing, but absent stays absent so a default can depend on another variable. */
const envBooleanOptional = () =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Cloud Run injects PORT and expects the container to listen on it. It wins over
   * API_PORT, which stays for local development where 3001 is the convention.
   */
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(3001),

  /**
   * Comma-separated, because the storefront and the console are deliberately separate
   * origins and both need to reach the API.
   */
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173,http://localhost:5174')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    ),

  DATABASE_URL: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // Only believed when the deployment actually sits behind a proxy we control.
  //
  // Parsed from an explicit set rather than with `z.coerce.boolean()`, which reads every
  // non-empty string as true — including "false". That silently turned proxy trust on and
  // made X-Forwarded-For believable from any caller, which is the one header an attacker
  // would forge to look like a different shopper on every request.
  TRUST_PROXY: envBoolean('false'),

  /**
   * Creates the published demo accounts at boot.
   *
   * Unset means on outside production and off in production. Both halves matter: a fresh
   * clone must be signable-in without anyone provisioning an account, and a deployment
   * must never seed a documented password because nobody thought about it. Setting it
   * explicitly overrides either way — which is how the hosted demo gets its accounts.
   */
  SEED_DEMO_USERS: envBooleanOptional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Required: the telemetry layer cannot pseudonymise without it, and a default would
  // make every deployment share one key.
  PSEUDONYM_KEY_V1: z.string().min(32, 'PSEUDONYM_KEY_V1 must be at least 32 characters'),
  PSEUDONYM_KEY_VERSION: z.coerce.number().int().positive().default(1),

  /**
   * Wraps the per-event data keys that encrypt webhook payloads. Optional at boot but
   * required to accept a webhook: without it the endpoint refuses the delivery rather than
   * storing a customer's email and contact number in plaintext.
   */
  PAYLOAD_KEY_V1: z.string().optional(),
  PAYLOAD_KEY_VERSION: z.coerce.number().int().positive().default(1),

  /**
   * How far behind the newest observed event time the watermark sits. An event arriving
   * within this bound still updates aggregates; one arriving beyond it is recorded and
   * counted, but never silently rewrites a decision already taken.
   */
  ALLOWED_LATENESS_MINUTES: z.coerce.number().int().nonnegative().default(5),

  /** How long an encrypted raw payload is kept before the ciphertext is dropped. */
  FORENSIC_RETENTION_DAYS: z.coerce.number().int().positive().default(7),

  /** Attempts before an inbox row is dead-lettered for a human to look at. */
  INBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  /** Drain tick. Zero disables the timer, which is what the tests want. */
  INBOX_DRAIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1000),

  /** Set false on the HTTP deployment when a separate `start:worker` process is used. */
  INBOX_WORKER_ENABLED: envBoolean('true'),

  /** Rows per drain pass. Bounded so one pass cannot occupy the process indefinitely. */
  INBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
});

/**
 * Production must name a real database.
 *
 * Without DATABASE_URL the app falls back to embedded Postgres, which is exactly right
 * locally and catastrophic in production: it starts cleanly, serves traffic, and loses
 * every row when the instance is replaced. Refusing to boot is the only safe answer,
 * because the failure is otherwise invisible until the data is already gone.
 */
const envSchemaChecked = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  if (env.DATABASE_URL === undefined || env.DATABASE_URL === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required in production — embedded Postgres is not durable',
    });
  }

  if (env.RAZORPAY_WEBHOOK_SECRET === undefined || env.RAZORPAY_WEBHOOK_SECRET === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RAZORPAY_WEBHOOK_SECRET'],
      message:
        'RAZORPAY_WEBHOOK_SECRET is required in production — live webhooks must be authenticated',
    });
  }

  if (env.PAYLOAD_KEY_V1 === undefined || env.PAYLOAD_KEY_V1 === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PAYLOAD_KEY_V1'],
      message: 'PAYLOAD_KEY_V1 is required in production — webhook payloads must be encrypted',
    });
  }
});

const envSchemaResolved = envSchemaChecked.transform((env) => ({
  ...env,
  SEED_DEMO_USERS: env.SEED_DEMO_USERS ?? env.NODE_ENV !== 'production',
}));

export type Env = z.infer<typeof envSchemaResolved>;

/** Fails loudly at boot rather than producing undefined behaviour later. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchemaResolved.parse(source);
}

/** Cloud Run's PORT wins; API_PORT is the local convention. */
export function resolvePort(env: Env): number {
  return env.PORT ?? env.API_PORT;
}
