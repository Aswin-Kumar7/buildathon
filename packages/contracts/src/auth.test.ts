import { describe, expect, it } from 'vitest';
import { loginRequestSchema, meResponseSchema, sessionUserSchema } from './auth.js';

describe('loginRequestSchema', () => {
  it('accepts a valid credential pair', () => {
    const parsed = loginRequestSchema.parse({ email: 'a@b.com', password: 'x' });
    expect(parsed.email).toBe('a@b.com');
  });

  it('rejects a malformed email with a readable message', () => {
    const result = loginRequestSchema.safeParse({ email: 'nope', password: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Enter a valid email address');
    }
  });

  it('rejects an empty password', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('sessionUserSchema', () => {
  it('rejects an unknown role', () => {
    const bad = { id: crypto.randomUUID(), email: 'a@b.com', displayName: 'A', role: 'root' };
    expect(sessionUserSchema.safeParse(bad).success).toBe(false);
  });
});

describe('meResponseSchema', () => {
  it('treats a signed-out caller as valid rather than an error', () => {
    expect(meResponseSchema.parse({ user: null, csrfToken: null }).user).toBeNull();
  });
});
