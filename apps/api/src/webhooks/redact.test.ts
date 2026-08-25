import { describe, expect, it } from 'vitest';
import { FORBIDDEN_FIELDS, toCanonical, toEventTime, webhookEnvelopeSchema } from './redact.js';
import { orderPaidBody, paymentCapturedBody, paymentFailedBody } from './fixtures.js';

const receivedAt = new Date('2026-01-01T00:05:00.000Z');

const canonical = (body: Record<string, unknown>) =>
  toCanonical(webhookEnvelopeSchema.parse(body), receivedAt);

describe('webhookEnvelopeSchema', () => {
  it('accepts an event carrying fields it has never seen', () => {
    // Rejecting an unrecognised field would mean losing a real event: Razorpay retries for
    // 24 hours and then stops, and the event is gone.
    const parsed = webhookEnvelopeSchema.parse({
      event: 'payment.failed',
      some_field_added_next_year: { nested: true },
    });
    expect(parsed.event).toBe('payment.failed');
  });

  it('requires an event name, which is the one field everything keys on', () => {
    expect(() => webhookEnvelopeSchema.parse({ payload: {} })).toThrow();
  });
});

describe('toEventTime', () => {
  it('converts Razorpay seconds to milliseconds', () => {
    expect(toEventTime(1_767_225_600, receivedAt).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to arrival time when the timestamp is missing', () => {
    expect(toEventTime(undefined, receivedAt)).toEqual(receivedAt);
  });

  it('falls back rather than placing the event in 1970', () => {
    // A zero timestamp taken literally empties every velocity window, and a detector that
    // sees nothing reports no fraud.
    expect(toEventTime(0, receivedAt)).toEqual(receivedAt);
    expect(toEventTime('not a number', receivedAt)).toEqual(receivedAt);
  });
});

describe('toCanonical', () => {
  it('extracts the identifiers that join an event to a checkout session', () => {
    const event = canonical(paymentFailedBody());
    expect(event.eventType).toBe('payment.failed');
    expect(event.entityType).toBe('payment');
    expect(event.razorpayOrderId).toBe('order_TESTORDER001');
    expect(event.razorpayPaymentId).toBe('pay_TESTFAILED001');
  });

  it('keeps the failure vocabulary, which is the richest signal on a decline', () => {
    const event = canonical(paymentFailedBody());
    expect(event.errorCode).toBe('BAD_REQUEST_ERROR');
    expect(event.errorReason).toBe('payment_failed');
    expect(event.errorSource).toBe('bank');
    expect(event.errorStep).toBe('payment_authorization');
  });

  it('keeps the coarse card cohort', () => {
    const event = canonical(paymentFailedBody());
    expect(event.cardNetwork).toBe('Visa');
    expect(event.cardType).toBe('credit');
    expect(event.cardIssuer).toBe('HDFC');
    expect(event.cardId).toBe('card_TESTCARD001');
    expect(event.international).toBe(false);
  });

  it('drops every customer-associated field', () => {
    const event = canonical(paymentFailedBody());
    const serialised = JSON.stringify(event);

    expect(serialised).not.toContain('shopper@example.com');
    expect(serialised).not.toContain('+919876543210');
    expect(serialised).not.toContain('1111'); // card last four
    expect(serialised).not.toContain('A Shopper');
    expect(serialised).not.toContain('acc_TESTACCOUNT');
  });

  it('drops the vpa on a upi payment', () => {
    expect(JSON.stringify(canonical(paymentCapturedBody()))).not.toContain('shopper@okbank');
  });

  it('carries none of the forbidden field names as keys', () => {
    const keys = Object.keys(canonical(paymentFailedBody()));
    for (const forbidden of FORBIDDEN_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('is a whitelist, so a field invented tomorrow is excluded by default', () => {
    const body = paymentFailedBody();
    const entity = (body['payload'] as Record<string, Record<string, Record<string, unknown>>>)[
      'payment'
    ]!['entity']!;
    entity['customer_pan'] = 'ABCDE1234F';
    entity['aadhaar_last4'] = '9999';

    expect(JSON.stringify(canonical(body))).not.toContain('ABCDE1234F');
    expect(JSON.stringify(canonical(body))).not.toContain('9999');
  });

  it('prefers the payment entity when an event contains several', () => {
    const event = canonical(orderPaidBody());
    expect(event.entityType).toBe('payment');
    expect(event.razorpayPaymentId).toBe('pay_TESTCAPTURED01');
    expect(event.razorpayOrderId).toBe('order_TESTORDER001');
  });

  it('reads the order id from an order-only event, where it is the entity id', () => {
    const body = orderPaidBody();
    delete (body['payload'] as Record<string, unknown>)['payment'];

    const event = canonical(body);
    expect(event.entityType).toBe('order');
    expect(event.razorpayOrderId).toBe('order_TESTORDER001');
    expect(event.razorpayPaymentId).toBeNull();
  });

  it('survives an event with no payload at all', () => {
    const event = canonical({ event: 'payment.failed' });
    expect(event.eventType).toBe('payment.failed');
    expect(event.razorpayOrderId).toBeNull();
    expect(event.eventAt).toEqual(receivedAt);
  });

  it('survives a payload whose entity is empty', () => {
    const event = canonical({ event: 'payment.failed', payload: { payment: { entity: {} } } });
    expect(event.entityType).toBeNull();
    expect(event.amountPaise).toBeNull();
  });

  it('keeps the amount in paise, as an integer', () => {
    const event = canonical(paymentFailedBody());
    expect(event.amountPaise).toBe(49_900);
    expect(Number.isInteger(event.amountPaise)).toBe(true);
  });

  it('uses the envelope event time, not the entity time, when they differ', () => {
    // The envelope timestamp is when Razorpay emitted the event; the entity timestamp is
    // when the underlying thing happened. Windowing on the emission time is what keeps a
    // retry storm from looking like a spike.
    const event = canonical(orderPaidBody());
    expect(event.eventAt.toISOString()).toBe('2026-01-01T00:02:00.000Z');
  });
});
