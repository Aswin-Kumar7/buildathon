import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is specified for

export interface SealedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedKey: string;
  wrappedKeyIv: string;
  wrappedKeyTag: string;
  keyVersion: number;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

/**
 * Turns the configured hex string into a 32-byte key.
 *
 * Rejecting a short key here rather than padding it is deliberate: silently stretching a
 * weak key produces something that looks encrypted and is not.
 */
export function toKey(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new EnvelopeError(
      `payload key must be ${KEY_BYTES} bytes as hex (${KEY_BYTES * 2} characters)`,
    );
  }
  return key;
}

/**
 * Envelope encryption: a fresh random data key encrypts the payload, and the long-lived
 * key encrypts only that data key.
 *
 * Two reasons this beats encrypting every payload directly under one key. The long-lived
 * key encrypts a few hundred bytes over its whole life rather than gigabytes, which keeps
 * it far away from the birthday bound on GCM nonce reuse. And rotating it means rewrapping
 * one small key per row instead of decrypting and re-encrypting every payload ever
 * received.
 *
 * AES-256-GCM throughout, so tampering with a stored row fails authentication rather than
 * decrypting to plausible-looking rubbish.
 */
export function seal(plaintext: string, masterKey: Buffer, keyVersion: number): SealedPayload {
  const dataKey = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const wrapIv = randomBytes(IV_BYTES);
  const wrapper = createCipheriv(ALGORITHM, masterKey, wrapIv);
  const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);

  // The data key exists in memory for the length of this function and nowhere else.
  dataKey.fill(0);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    wrappedKey: wrappedKey.toString('base64'),
    wrappedKeyIv: wrapIv.toString('base64'),
    wrappedKeyTag: wrapper.getAuthTag().toString('base64'),
    keyVersion,
  };
}

export function open(sealed: SealedPayload, masterKey: Buffer): string {
  try {
    const unwrapper = createDecipheriv(
      ALGORITHM,
      masterKey,
      Buffer.from(sealed.wrappedKeyIv, 'base64'),
    );
    unwrapper.setAuthTag(Buffer.from(sealed.wrappedKeyTag, 'base64'));
    const dataKey = Buffer.concat([
      unwrapper.update(Buffer.from(sealed.wrappedKey, 'base64')),
      unwrapper.final(),
    ]);

    const decipher = createDecipheriv(ALGORITHM, dataKey, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');

    dataKey.fill(0);
    return plaintext;
  } catch {
    // The reason is never surfaced, and the original error is not attached: distinguishing
    // "wrong key" from "tampered ciphertext" for a caller is a decryption oracle.
    throw new EnvelopeError('could not open the sealed payload');
  }
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on a signature leaks how many leading bytes were correct through timing, which is
 * enough to forge one byte at a time given enough attempts.
 */
export function digestsMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
