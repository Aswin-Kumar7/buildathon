import { describe, expect, it } from 'vitest';
import { loadEnv, resolvePort } from './env.js';

const minimal = { PSEUDONYM_KEY_V1: 'x'.repeat(64) };

describe('loadEnv', () => {
  it('applies defaults when only the required secret is set', () => {
    const env = loadEnv(minimal);
    expect(env.API_PORT).toBe(3001);
    expect(env.SESSION_TTL_HOURS).toBe(12);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('coerces numeric strings', () => {
    expect(loadEnv({ ...minimal, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects an unknown NODE_ENV rather than guessing', () => {
    expect(() => loadEnv({ ...minimal, NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadEnv({ ...minimal, API_PORT: 'abc' })).toThrow();
  });

  it('refuses to start without a pseudonym key', () => {
    // There is deliberately no default: a shared fallback key would make pseudonyms
    // reproducible by anyone who read the source.
    expect(() => loadEnv({})).toThrow();
  });

  it('refuses a pseudonym key that is too short to be a real secret', () => {
    expect(() => loadEnv({ PSEUDONYM_KEY_V1: 'short' })).toThrow();
  });

  it('reads TRUST_PROXY=false as false', () => {
    // Zod's boolean coercion treats every non-empty string as true, so the literal string
    // "false" would switch proxy trust *on*. That means believing an X-Forwarded-For
    // header from any caller — and the client address is what the detector correlates on,
    // so forging it would let one attacker look like thousands of separate shoppers.
    expect(loadEnv({ ...minimal, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...minimal, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(false);
  });

  it('reads TRUST_PROXY=true as true', () => {
    expect(loadEnv({ ...minimal, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadEnv({ ...minimal, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(true);
  });

  it('rejects a TRUST_PROXY value that is neither, rather than guessing', () => {
    expect(() => loadEnv({ ...minimal, TRUST_PROXY: 'yes' })).toThrow();
  });

  it('seeds the demo accounts by default outside production', () => {
    // A fresh clone has to be signable-in without anyone provisioning an account.
    expect(loadEnv({ ...minimal, NODE_ENV: 'development' }).SEED_DEMO_USERS).toBe(true);
  });

  it('does not seed them in production unless asked', () => {
    const production = { ...minimal, NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' };
    expect(loadEnv(production).SEED_DEMO_USERS).toBe(false);
    expect(loadEnv({ ...production, SEED_DEMO_USERS: 'true' }).SEED_DEMO_USERS).toBe(true);
  });

  it('lets seeding be switched off in development too', () => {
    expect(
      loadEnv({ ...minimal, NODE_ENV: 'development', SEED_DEMO_USERS: 'false' }).SEED_DEMO_USERS,
    ).toBe(false);
  });

  it('refuses to start in production without a database', () => {
    // The alternative is worse than a crash: embedded Postgres starts cleanly, serves
    // traffic, and loses every row when the instance is replaced.
    expect(() => loadEnv({ ...minimal, NODE_ENV: 'production' })).toThrow();
  });

  it('reads the port Cloud Run injects in preference to API_PORT', () => {
    expect(resolvePort(loadEnv({ ...minimal, PORT: '8080', API_PORT: '3001' }))).toBe(8080);
    expect(resolvePort(loadEnv({ ...minimal, API_PORT: '3001' }))).toBe(3001);
  });

  it('reads WEB_ORIGIN as a list, because the console and the shop are separate origins', () => {
    const env = loadEnv({ ...minimal, WEB_ORIGIN: 'https://a.example , https://b.example' });
    expect(env.WEB_ORIGIN).toEqual(['https://a.example', 'https://b.example']);
  });
});
