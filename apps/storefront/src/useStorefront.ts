import { useEffect, useState } from 'react';
import {
  catalogResponseSchema,
  createOrderResponseSchema,
  type CatalogItem,
} from '@sentinel/contracts';
import { getClientSessionId } from './session.js';
import { openCheckout } from './checkout.js';
import type { Status } from './CheckoutPanel.js';

const MAX_PER_LINE = 10;

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return String((body as { message: unknown }).message);
  }
  return fallback;
}

export interface Storefront {
  catalog: CatalogItem[];
  cart: Record<string, number>;
  totalPaise: number;
  canCheckout: boolean;
  email: string;
  setEmail: (email: string) => void;
  status: Status;
  adjust: (sku: string, delta: number) => void;
  checkout: () => void;
}

/**
 * All of the shop's behaviour, kept out of the markup so it can be exercised without
 * rendering and so the component stays readable as the checkout flow grows.
 */
export function useStorefront(): Storefront {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    // Minted on arrival rather than at checkout, so the identifier covers the whole visit
    // — including the attempts that never reach a payment, which are exactly the ones a
    // card-testing run produces.
    getClientSessionId();

    void (async () => {
      try {
        const response = await fetch('/api/catalog');
        const parsed = catalogResponseSchema.parse(await response.json());
        setCatalog(parsed.items);
      } catch {
        setStatus({ kind: 'error', message: 'Could not load the catalogue' });
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
    setStatus({ kind: 'creating' });
    try {
      const response = await fetch('/api/orders', {
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
        setStatus({ kind: 'error', message: messageFrom(body, 'Could not start checkout') });
        return;
      }

      const order = createOrderResponseSchema.parse(await response.json());
      const outcome = await openCheckout(order, { email: email === '' ? undefined : email });
      setStatus({ kind: 'outcome', outcome });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not start checkout',
      });
    }
  }

  return {
    catalog,
    cart,
    totalPaise,
    canCheckout: lines.length > 0,
    email,
    setEmail,
    status,
    adjust,
    checkout: () => void run(),
  };
}
