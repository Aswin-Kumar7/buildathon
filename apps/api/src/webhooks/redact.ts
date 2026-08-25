import { z } from 'zod';

/**
 * Razorpay's webhook envelope, read leniently.
 *
 * Deliberately permissive: a strict schema would reject a real event the moment Razorpay
 * adds a field, and rejecting a real event means losing it — they retry for 24 hours and
 * then stop. So every field is optional, unknown keys pass through, and the parts we
 * actually need are validated where they are read.
 */
export const webhookEnvelopeSchema = z
  .object({
    entity: z.string().optional(),
    account_id: z.string().optional(),
    event: z.string(),
    contains: z.array(z.string()).optional(),
    created_at: z.number().optional(),
    payload: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export interface CanonicalDraft {
  eventType: string;
  entityType: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  status: string | null;
  method: string | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorDescription: string | null;
  cardNetwork: string | null;
  cardType: string | null;
  cardIssuer: string | null;
  cardId: string | null;
  international: boolean | null;
  eventAt: Date;
}

/**
 * Field names that must never reach the canonical event, a log line, a fixture or a
 * prompt. Exported so a test can assert the redactor's output against the same list CI
 * greps for, rather than two lists drifting apart.
 */
export const FORBIDDEN_FIELDS = [
  'email',
  'contact',
  'last4',
  'vpa',
  'name',
  'customer_id',
  'bank_transaction_id',
  'notes',
  'account_id',
] as const;

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The first entity in the payload, along with what kind it is.
 *
 * `contains` names the entities present, but its order is not something to depend on, so
 * the payment is preferred when one exists — it carries the outcome, the failure reason
 * and the card cohort, which is nearly everything the detector wants.
 */
function primaryEntity(payload: Record<string, unknown>): {
  type: string | null;
  entity: Record<string, unknown>;
} {
  const order = ['payment', 'order', 'refund', 'dispute'];
  const keys = [
    ...order.filter((k) => k in payload),
    ...Object.keys(payload).filter((k) => !order.includes(k)),
  ];

  for (const key of keys) {
    const entity = record(record(payload[key]).entity);
    if (Object.keys(entity).length > 0) return { type: key, entity };
  }
  return { type: null, entity: {} };
}

/**
 * Razorpay sends seconds since the epoch; JavaScript wants milliseconds. Getting this
 * wrong puts every event in 1970, which makes every velocity window empty and every
 * detector silent — a failure that looks like "no fraud found".
 */
export function toEventTime(seconds: unknown, fallback: Date): Date {
  const value = num(seconds);
  if (value === null || value <= 0) return fallback;
  return new Date(value * 1000);
}

/**
 * Derives the redacted canonical event.
 *
 * This is a whitelist, not a blacklist. Nothing is copied across unless it is named here,
 * so a new customer-associated field appearing in a future Razorpay payload is excluded
 * by default rather than leaking until somebody notices.
 */
export function toCanonical(envelope: WebhookEnvelope, receivedAt: Date): CanonicalDraft {
  const payload = record(envelope.payload);
  const { type, entity } = primaryEntity(payload);
  const card = record(entity['card']);

  // An order-only event carries no order_id of its own; its `id` is the order id.
  const orderId = str(entity['order_id']) ?? (type === 'order' ? str(entity['id']) : null);
  const paymentId = type === 'payment' ? str(entity['id']) : str(entity['payment_id']);

  return {
    eventType: envelope.event,
    entityType: type,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    amountPaise: num(entity['amount']),
    currency: str(entity['currency']),
    status: str(entity['status']),
    method: str(entity['method']),
    errorCode: str(entity['error_code']),
    errorReason: str(entity['error_reason']),
    errorSource: str(entity['error_source']),
    errorStep: str(entity['error_step']),
    errorDescription: str(entity['error_description']),

    // Coarse card cohort only. `last4` is deliberately absent: for a tokenised card it is
    // the token's last four rather than the card's, so it identifies a person without even
    // being the signal it appears to be.
    cardNetwork: str(card['network']),
    cardType: str(card['type']),
    cardIssuer: str(card['issuer']),
    cardId: str(entity['card_id']) ?? str(card['id']),
    international: bool(entity['international']) ?? bool(card['international']),

    eventAt: toEventTime(envelope.created_at ?? entity['created_at'], receivedAt),
  };
}
