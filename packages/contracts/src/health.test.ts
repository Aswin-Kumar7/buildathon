import { describe, expect, it } from 'vitest';
import { healthSchema } from './health.js';

describe('healthSchema', () => {
  const valid = {
    status: 'ok',
    version: '0.0.1',
    commit: 'abc1234',
    startedAt: '2026-08-24T10:00:00.000Z',
  };

  it('accepts a well-formed payload', () => {
    expect(healthSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a non-ok status', () => {
    expect(() => healthSchema.parse({ ...valid, status: 'degraded' })).toThrow();
  });

  it('rejects a non-datetime startedAt', () => {
    expect(() => healthSchema.parse({ ...valid, startedAt: 'yesterday' })).toThrow();
  });

  it('rejects an empty commit', () => {
    expect(() => healthSchema.parse({ ...valid, commit: '' })).toThrow();
  });
});
