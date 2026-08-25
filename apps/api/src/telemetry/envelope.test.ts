import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { digestsMatch, EnvelopeError, open, seal, toKey } from './envelope.js';

const masterKey = randomBytes(32);
const payload = JSON.stringify({
  event: 'payment.failed',
  payload: { payment: { entity: { email: 'shopper@example.com', contact: '+919876543210' } } },
});

describe('toKey', () => {
  it('accepts a 32-byte hex key', () => {
    expect(toKey('a'.repeat(64))).toHaveLength(32);
  });

  it('rejects a key that is too short rather than stretching it', () => {
    // Padding a weak key produces something that looks encrypted and is not.
    expect(() => toKey('abcd')).toThrow(EnvelopeError);
  });

  it('rejects a key that is too long', () => {
    expect(() => toKey('a'.repeat(128))).toThrow(EnvelopeError);
  });
});

describe('seal and open', () => {
  it('round-trips a payload', () => {
    expect(open(seal(payload, masterKey, 1), masterKey)).toBe(payload);
  });

  it('leaves no plaintext in the sealed representation', () => {
    const sealed = seal(payload, masterKey, 1);
    const stored = JSON.stringify(sealed);
    expect(stored).not.toContain('shopper@example.com');
    expect(stored).not.toContain('+919876543210');
    expect(stored).not.toContain('payment.failed');
  });

  it('produces a different ciphertext each time for the same input', () => {
    // A deterministic ciphertext tells an observer which two rows hold the same payload.
    const a = seal(payload, masterKey, 1);
    const b = seal(payload, masterKey, 1);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedKey).not.toBe(b.wrappedKey);
    expect(a.iv).not.toBe(b.iv);
  });

  it('refuses a different master key', () => {
    const sealed = seal(payload, masterKey, 1);
    expect(() => open(sealed, randomBytes(32))).toThrow(EnvelopeError);
  });

  it('refuses a tampered ciphertext instead of returning rubbish', () => {
    const sealed = seal(payload, masterKey, 1);
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => open({ ...sealed, ciphertext: bytes.toString('base64') }, masterKey)).toThrow(
      EnvelopeError,
    );
  });

  it('refuses a tampered auth tag', () => {
    const sealed = seal(payload, masterKey, 1);
    expect(() =>
      open({ ...sealed, authTag: Buffer.alloc(16).toString('base64') }, masterKey),
    ).toThrow(EnvelopeError);
  });

  it('refuses a wrapped key taken from a different row', () => {
    const a = seal(payload, masterKey, 1);
    const b = seal(payload, masterKey, 1);
    expect(() => open({ ...a, wrappedKey: b.wrappedKey }, masterKey)).toThrow(EnvelopeError);
  });

  it('records the key version so a rotated key can still open old rows', () => {
    expect(seal(payload, masterKey, 2).keyVersion).toBe(2);
  });

  it('never reveals why decryption failed', () => {
    // Distinguishing "wrong key" from "tampered ciphertext" for a caller is an oracle.
    const sealed = seal(payload, masterKey, 1);
    const wrongKey = (() => {
      try {
        open(sealed, randomBytes(32));
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    const tampered = (() => {
      try {
        open({ ...sealed, authTag: Buffer.alloc(16).toString('base64') }, masterKey);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(wrongKey).toBe(tampered);
  });
});

describe('digestsMatch', () => {
  it('matches identical digests', () => {
    expect(digestsMatch('abc123', 'abc123')).toBe(true);
  });

  it('rejects different digests', () => {
    expect(digestsMatch('abc123', 'abc124')).toBe(false);
  });

  it('rejects digests of different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch, which would turn a malformed signature
    // header into a 500 instead of a rejection.
    expect(digestsMatch('abc', 'abcdef')).toBe(false);
  });

  it('rejects an empty received digest', () => {
    expect(digestsMatch('abc123', '')).toBe(false);
  });
});
