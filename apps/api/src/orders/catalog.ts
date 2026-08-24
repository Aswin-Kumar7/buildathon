import type { CartLine, CatalogItem } from '@sentinel/contracts';

/**
 * The server's price list, and the only one that counts.
 *
 * Amounts are in paise throughout, matching Razorpay's own convention. Keeping money as
 * integers avoids the floating-point rounding that turns ₹499.00 into ₹498.99999999.
 */
export const CATALOG: readonly CatalogItem[] = [
  {
    sku: 'kettle-01',
    name: 'Electric kettle',
    description: '1.5 litre, stainless steel',
    pricePaise: 149_900,
  },
  {
    sku: 'grinder-01',
    name: 'Coffee grinder',
    description: 'Conical burr, 40 settings',
    pricePaise: 349_900,
  },
  {
    sku: 'mug-01',
    name: 'Insulated mug',
    description: '350ml, keeps heat six hours',
    pricePaise: 49_900,
  },
  {
    sku: 'filter-02',
    name: 'Filter papers',
    description: 'Pack of 100, unbleached',
    pricePaise: 19_900,
  },
] as const;

export class UnknownSkuError extends Error {
  constructor(readonly sku: string) {
    super(`Unknown SKU: ${sku}`);
    this.name = 'UnknownSkuError';
  }
}

export function findItem(sku: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.sku === sku);
}

export interface PricedCart {
  amountPaise: number;
  itemCount: number;
}

/**
 * Prices a cart from the catalogue. An unknown SKU is rejected rather than skipped —
 * silently dropping a line would let a client change what it is buying after the fact.
 */
export function priceCart(lines: readonly CartLine[]): PricedCart {
  let amountPaise = 0;
  let itemCount = 0;

  for (const line of lines) {
    const item = findItem(line.sku);
    if (item === undefined) throw new UnknownSkuError(line.sku);
    amountPaise += item.pricePaise * line.quantity;
    itemCount += line.quantity;
  }

  return { amountPaise, itemCount };
}
