/**
 * Webhook bodies shaped like Razorpay's, for tests.
 *
 * The customer-associated fields are present on purpose. A redactor is only worth testing
 * against a payload that actually contains something worth redacting, and every value here
 * is invented.
 */
export function paymentFailedBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_TESTACCOUNT',
    event: 'payment.failed',
    contains: ['payment'],
    created_at: 1_767_225_600, // 2026-01-01T00:00:00Z
    payload: {
      payment: {
        entity: {
          id: 'pay_TESTFAILED001',
          entity: 'payment',
          amount: 49_900,
          currency: 'INR',
          status: 'failed',
          order_id: 'order_TESTORDER001',
          method: 'card',
          amount_refunded: 0,
          captured: false,
          description: 'Demo storefront — test mode',
          card_id: 'card_TESTCARD001',
          card: {
            id: 'card_TESTCARD001',
            entity: 'card',
            name: 'A Shopper',
            last4: '1111',
            network: 'Visa',
            type: 'credit',
            issuer: 'HDFC',
            international: false,
            sub_type: 'consumer',
          },
          email: 'shopper@example.com',
          contact: '+919876543210',
          notes: { source: 'sentinel-storefront' },
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Your payment was declined by the bank.',
          error_source: 'bank',
          error_step: 'payment_authorization',
          error_reason: 'payment_failed',
          created_at: 1_767_225_600,
        },
      },
    },
    ...overrides,
  };
}

export function paymentCapturedBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_TESTACCOUNT',
    event: 'payment.captured',
    contains: ['payment'],
    created_at: 1_767_225_660,
    payload: {
      payment: {
        entity: {
          id: 'pay_TESTCAPTURED01',
          entity: 'payment',
          amount: 49_900,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_TESTORDER001',
          method: 'upi',
          vpa: 'shopper@okbank',
          email: 'shopper@example.com',
          contact: '+919876543210',
          created_at: 1_767_225_660,
        },
      },
    },
    ...overrides,
  };
}

export function orderPaidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_TESTACCOUNT',
    event: 'order.paid',
    contains: ['order', 'payment'],
    created_at: 1_767_225_720,
    payload: {
      order: {
        entity: {
          id: 'order_TESTORDER001',
          entity: 'order',
          amount: 49_900,
          amount_paid: 49_900,
          currency: 'INR',
          status: 'paid',
          receipt: 'sentinel-00000000-0000-0000-0000-000000000000',
          created_at: 1_767_225_720,
        },
      },
      payment: {
        entity: {
          id: 'pay_TESTCAPTURED01',
          entity: 'payment',
          amount: 49_900,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_TESTORDER001',
          method: 'upi',
          created_at: 1_767_225_660,
        },
      },
    },
    ...overrides,
  };
}
