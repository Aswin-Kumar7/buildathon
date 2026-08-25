import { describe, expect, it } from 'vitest';
import { deduplicationKey, sign, verifySignature } from './signature.js';
import { paymentFailedBody } from './fixtures.js';

const secret = 'whsec_test_0123456789';
const raw = Buffer.from(JSON.stringify(paymentFailedBody()));

describe('sign', () => {
  it('produces a stable hex digest', () => {
    expect(sign(raw, secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(sign(raw, secret)).toBe(sign(raw, secret));
  });

  it('changes with the secret', () => {
    expect(sign(raw, secret)).not.toBe(sign(raw, 'whsec_other'));
  });

  it('changes with a single byte of the body', () => {
    const tampered = Buffer.from(raw);
    tampered[10] = tampered[10]! ^ 0x01;
    expect(sign(raw, secret)).not.toBe(sign(tampered, secret));
  });

  it('treats a re-serialised body as a different message', () => {
    // This is the whole reason the raw bytes are preserved. Parsing and re-stringifying
    // reorders keys and drops whitespace, and the digest no longer matches — which is
    // where "signature mismatch on a valid event" comes from.
    const reserialised = JSON.stringify(JSON.parse(raw.toString('utf8')));
    const spaced = JSON.stringify(JSON.parse(raw.toString('utf8')), null, 2);
    expect(sign(spaced, secret)).not.toBe(sign(reserialised, secret));
  });
});

describe('verifySignature', () => {
  it('accepts a correct signature', () => {
    expect(verifySignature(raw, sign(raw, secret), secret)).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    expect(verifySignature(raw, sign(raw, 'whsec_other'), secret)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifySignature(raw, undefined, secret)).toBe(false);
    expect(verifySignature(raw, '', secret)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    // A short header would make a naive constant-time compare throw, turning a rejection
    // into a 500 and telling the sender their input was interestingly wrong.
    expect(verifySignature(raw, 'nonsense', secret)).toBe(false);
    expect(verifySignature(raw, 'z'.repeat(64), secret)).toBe(false);
  });

  it('rejects a signature for a different body', () => {
    const other = Buffer.from(JSON.stringify(paymentFailedBody({ event: 'payment.captured' })));
    expect(verifySignature(raw, sign(other, secret), secret)).toBe(false);
  });
});

describe('deduplicationKey', () => {
  it('uses the event id header when Razorpay sends one', () => {
    expect(deduplicationKey(raw, 'evt_TESTEVENT001')).toBe('evt_TESTEVENT001');
  });

  it('falls back to a digest of the body when the header is absent', () => {
    expect(deduplicationKey(raw, undefined)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('gives a redelivery of the same event the same fallback key', () => {
    expect(deduplicationKey(raw, undefined)).toBe(deduplicationKey(Buffer.from(raw), undefined));
  });

  it('gives different events different fallback keys', () => {
    const other = Buffer.from(JSON.stringify(paymentFailedBody({ event: 'payment.captured' })));
    expect(deduplicationKey(raw, undefined)).not.toBe(deduplicationKey(other, undefined));
  });
});
