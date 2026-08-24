import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults when nothing is set', () => {
    const env = loadEnv({});
    expect(env.API_PORT).toBe(3001);
    expect(env.SESSION_TTL_HOURS).toBe(12);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('coerces numeric strings', () => {
    expect(loadEnv({ API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects an unknown NODE_ENV rather than guessing', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadEnv({ API_PORT: 'abc' })).toThrow();
  });
});
