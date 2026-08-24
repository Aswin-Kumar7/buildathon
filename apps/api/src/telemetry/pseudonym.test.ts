import { describe, expect, it } from 'vitest';
import { pseudonymise, pseudonymiseIp, resolveClientIp, truncateIp } from './pseudonym.js';

const config = { key: 'test-key-not-a-real-secret', version: 1 };
const otherKey = { key: 'a-different-key', version: 1 };

describe('pseudonymise', () => {
  it('is stable for the same input, so correlation works', () => {
    expect(pseudonymise('a@b.com', config)).toBe(pseudonymise('a@b.com', config));
  });

  it('normalises case and surrounding whitespace', () => {
    expect(pseudonymise('  A@B.com ', config)).toBe(pseudonymise('a@b.com', config));
  });

  it('produces different values for different inputs', () => {
    expect(pseudonymise('a@b.com', config)).not.toBe(pseudonymise('c@d.com', config));
  });

  it('is keyed, so the value cannot be reproduced without the secret', () => {
    expect(pseudonymise('a@b.com', config)).not.toBe(pseudonymise('a@b.com', otherKey));
  });

  it('carries a version prefix so key rotation is detectable', () => {
    expect(pseudonymise('a@b.com', config)).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(pseudonymise('a@b.com', { ...config, version: 2 })).toMatch(/^v2:/);
  });

  it('never contains the original value', () => {
    expect(pseudonymise('secret@example.com', config)).not.toContain('secret');
  });
});

describe('truncateIp', () => {
  it('drops the final octet of an IPv4 address', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0/24');
  });

  it('keeps addresses in the same /24 together', () => {
    expect(truncateIp('203.0.113.7')).toBe(truncateIp('203.0.113.200'));
  });

  it('separates different networks', () => {
    expect(truncateIp('203.0.113.7')).not.toBe(truncateIp('198.51.100.7'));
  });

  it('truncates IPv6 to /48', () => {
    expect(truncateIp('2001:db8:1234:5678::1')).toBe('2001:db8:1234::/48');
  });

  it('returns a marker for something that is not an address', () => {
    expect(truncateIp('not-an-ip')).toBe('unknown');
  });
});

describe('pseudonymiseIp', () => {
  it('truncates before hashing, so the exact address is never hashed at all', () => {
    // Two hosts on one network must be indistinguishable in the stored value.
    expect(pseudonymiseIp('203.0.113.7', config)).toBe(pseudonymiseIp('203.0.113.99', config));
  });
});

describe('resolveClientIp', () => {
  it('uses the socket address when no proxy is trusted', () => {
    expect(resolveClientIp('10.0.0.1', '1.2.3.4', false)).toBe('10.0.0.1');
  });

  it('ignores a forwarding header that a client could have forged', () => {
    // Without an explicitly trusted proxy this header is attacker-controlled input.
    expect(resolveClientIp('10.0.0.1', 'attacker-supplied', false)).toBe('10.0.0.1');
  });

  it('uses the first forwarded address behind a trusted proxy', () => {
    expect(resolveClientIp('10.0.0.1', '203.0.113.7, 10.0.0.5', true)).toBe('203.0.113.7');
  });

  it('falls back to the socket address when the header is empty', () => {
    expect(resolveClientIp('10.0.0.1', '', true)).toBe('10.0.0.1');
  });

  it('reports unknown rather than throwing when there is no address at all', () => {
    expect(resolveClientIp(undefined, undefined, false)).toBe('unknown');
  });
});
