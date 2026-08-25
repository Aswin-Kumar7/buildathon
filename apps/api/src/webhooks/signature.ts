import { createHash, createHmac } from 'node:crypto';
import { digestsMatch } from '../telemetry/envelope.js';

export const SIGNATURE_HEADER = 'x-razorpay-signature';
export const EVENT_ID_HEADER = 'x-razorpay-event-id';

/**
 * HMAC-SHA256 over the exact bytes Razorpay sent.
 *
 * Over the *bytes*, not over a re-serialised object: `JSON.parse` followed by
 * `JSON.stringify` reorders keys, drops insignificant whitespace and renormalises unicode
 * escapes, any one of which changes the digest. Every "signature mismatch on a valid
 * event" bug is this one.
 */
export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(
  rawBody: Buffer | string,
  received: string | undefined,
  secret: string,
): boolean {
  if (received === undefined || received === '') return false;
  return digestsMatch(sign(rawBody, secret), received);
}

/**
 * The deduplication key.
 *
 * Razorpay puts an event id in a header rather than the body, and older integrations may
 * not send it at all. Falling back to a digest of the raw bytes keeps deduplication
 * working either way, because a redelivery of the same event is byte-identical — and it
 * is a hash, so it never becomes a way to smuggle a chosen primary key into our table.
 */
export function deduplicationKey(rawBody: Buffer | string, header: string | undefined): string {
  if (header !== undefined && header !== '') return header;
  return `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
}
