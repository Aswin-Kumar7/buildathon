import type { CreateOrderResponse } from '@sentinel/contracts';

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: { razorpay_payment_id: string }) => void;
  modal: { ondismiss: () => void };
  prefill?: { email?: string };
  theme: { color: string };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loaded on demand rather than in the page head, so a blocked CDN cannot stop the shop rendering. */
export function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay !== undefined) return Promise.resolve();
  if (scriptPromise !== null) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load the Razorpay checkout script'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export type CheckoutOutcome =
  { kind: 'paid'; paymentId: string } | { kind: 'dismissed' } | { kind: 'failed'; reason: string };

/**
 * Opens Razorpay's hosted checkout.
 *
 * The card number is entered inside Razorpay's own iframe and never reaches this
 * application — that is the whole point of hosted checkout, and it is why the detector
 * downstream can never key on a PAN or a BIN.
 */
export async function openCheckout(
  order: CreateOrderResponse,
  options: { email?: string | undefined },
): Promise<CheckoutOutcome> {
  await loadCheckoutScript();

  const Razorpay = window.Razorpay;
  if (Razorpay === undefined) return { kind: 'failed', reason: 'checkout unavailable' };

  return new Promise<CheckoutOutcome>((resolve) => {
    const instance = new Razorpay({
      key: order.razorpayKeyId,
      amount: order.amountPaise,
      currency: order.currency,
      order_id: order.razorpayOrderId,
      name: 'Brew & Co',
      description: 'Demo storefront — test mode',
      handler: (response) => resolve({ kind: 'paid', paymentId: response.razorpay_payment_id }),
      modal: { ondismiss: () => resolve({ kind: 'dismissed' }) },
      ...(options.email !== undefined ? { prefill: { email: options.email } } : {}),
      theme: { color: '#0f766e' },
    });

    instance.on('payment.failed', (response) => {
      const description =
        typeof response === 'object' && response !== null && 'error' in response
          ? String(
              (response as { error: { description?: string } }).error.description ?? 'declined',
            )
          : 'declined';
      resolve({ kind: 'failed', reason: description });
    });

    instance.open();
  });
}
