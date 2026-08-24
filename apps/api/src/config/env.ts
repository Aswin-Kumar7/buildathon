import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
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
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Required: the telemetry layer cannot pseudonymise without it, and a default would
  // make every deployment share one key.
  PSEUDONYM_KEY_V1: z.string().min(32, 'PSEUDONYM_KEY_V1 must be at least 32 characters'),
  PSEUDONYM_KEY_VERSION: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

/** Fails loudly at boot rather than producing undefined behaviour later. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
