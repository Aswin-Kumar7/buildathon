import { useEffect, useState } from 'react';
import {
  catalogResponseSchema,
  createOrderResponseSchema,
  type CatalogItem,
} from '@sentinel/contracts';
import { getClientSessionId } from './session.js';
import { apiUrl } from './api.js';
import { openCheckout } from './checkout.js';
import type { PaymentPhase } from './PaymentStatusModal.js';

const MAX_PER_LINE = 10;

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return String((body as { message: unknown }).message);
  }
  return fallback;
}

export interface Storefront {
  catalog: CatalogItem[];
  catalogFailed: boolean;
  loading: boolean;
  cart: Record<string, number>;
  totalPaise: number;
  canCheckout: boolean;
  email: string;
  setEmail: (email: string) => void;
  /** Null whenever no payment is in flight and none has just finished. Drives the dialog. */
  phase: PaymentPhase | null;
  dismissPhase: () => void;
  adjust: (sku: string, delta: number) => void;
  checkout: () => void;
}

/**
 * All of the shop's behaviour, kept out of the markup so it can be exercised without
 * rendering and so the component stays readable as the checkout flow grows.
 *
 * A failed catalogue load is deliberately not a `phase`: it is a broken shop, not a broken
 * payment, and routing it through the payment dialog would pop a "we couldn't start checkout"
 * modal at someone who has not tried to buy anything.
 */
export function useStorefront(): Storefront {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<PaymentPhase | null>(null);

  useEffect(() => {
    // Minted on arrival rather than at checkout, so the identifier covers the whole visit
    // — including the attempts that never reach a payment, which are exactly the ones a
    // card-testing run produces.
    getClientSessionId();

    void (async () => {
      try {
        const response = await fetch(apiUrl('/api/catalog'));
        const parsed = catalogResponseSchema.parse(await response.json());
        setCatalog(parsed.items);
      } catch {
        setCatalogFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lines = Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([sku, quantity]) => ({ sku, quantity }));

  const totalPaise = lines.reduce((sum, line) => {
    const item = catalog.find((candidate) => candidate.sku === line.sku);
    return sum + (item?.pricePaise ?? 0) * line.quantity;
  }, 0);

  const adjust = (sku: string, delta: number): void => {
    setCart((current) => ({
      ...current,
      [sku]: Math.max(0, Math.min(MAX_PER_LINE, (current[sku] ?? 0) + delta)),
    }));
  };

  async function run(): Promise<void> {
    setPhase({ kind: 'creating' });
    try {
      const response = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No amount. The server prices the cart from its own catalogue; a total sent from
        // here would be a total an attacker could choose.
        body: JSON.stringify({
          lines,
          clientSessionId: getClientSessionId(),
          ...(email !== '' ? { email } : {}),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        setPhase({ kind: 'error', message: messageFrom(body, 'Could not start checkout') });
        return;
      }

      const order = createOrderResponseSchema.parse(await response.json());
      const outcome = await openCheckout(order, { email: email === '' ? undefined : email });
      setPhase({ kind: 'outcome', outcome });
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not start checkout',
      });
    }
  }

  return {
    catalog,
    catalogFailed,
    loading,
    cart,
    totalPaise,
    canCheckout: lines.length > 0,
    email,
    setEmail,
    phase,
    dismissPhase: () => setPhase(null),
    adjust,
    checkout: () => void run(),
  };
}
