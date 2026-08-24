import { describe, expect, it } from 'vitest';
import { CATALOG, findItem, priceCart, UnknownSkuError } from './catalog.js';
import { userAgentFamily } from './orders.service.js';

describe('catalog', () => {
  it('prices every amount as an integer number of paise', () => {
    for (const item of CATALOG) {
      expect(Number.isInteger(item.pricePaise)).toBe(true);
      expect(item.pricePaise).toBeGreaterThan(0);
    }
  });

  it('has no duplicate SKUs', () => {
    const skus = CATALOG.map((item) => item.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('finds a known item', () => {
    expect(findItem('mug-01')?.name).toBe('Insulated mug');
  });

  it('returns undefined for an unknown item', () => {
    expect(findItem('does-not-exist')).toBeUndefined();
  });
});

describe('priceCart', () => {
  it('totals a single line', () => {
    expect(priceCart([{ sku: 'mug-01', quantity: 1 }])).toEqual({
      amountPaise: 49_900,
      itemCount: 1,
    });
  });

  it('multiplies by quantity', () => {
    expect(priceCart([{ sku: 'mug-01', quantity: 3 }]).amountPaise).toBe(149_700);
  });

  it('sums across lines', () => {
    const result = priceCart([
      { sku: 'mug-01', quantity: 2 },
      { sku: 'filter-02', quantity: 1 },
    ]);
    expect(result.amountPaise).toBe(49_900 * 2 + 19_900);
    expect(result.itemCount).toBe(3);
  });

  it('rejects an unknown SKU instead of silently skipping it', () => {
    // Skipping would let a client change what it is buying after the price was agreed.
    expect(() =>
      priceCart([
        { sku: 'mug-01', quantity: 1 },
        { sku: 'ghost', quantity: 1 },
      ]),
    ).toThrow(UnknownSkuError);
  });

  it('never produces a fractional amount', () => {
    const result = priceCart([
      { sku: 'kettle-01', quantity: 3 },
      { sku: 'grinder-01', quantity: 2 },
    ]);
    expect(Number.isInteger(result.amountPaise)).toBe(true);
  });
});

describe('userAgentFamily', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', 'chrome'],
    ['Mozilla/5.0 (Macintosh) Firefox/121.0', 'firefox'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1', 'ios'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/120.0', 'android'],
    ['curl/8.4.0', 'tool'],
    ['python-requests/2.31.0', 'tool'],
    ['HeadlessChrome/120.0', 'headless'],
    ['Googlebot/2.1', 'bot'],
  ])('classifies %s as %s', (raw, expected) => {
    expect(userAgentFamily(raw)).toBe(expected);
  });

  it('returns unknown when there is no user agent', () => {
    expect(userAgentFamily(undefined)).toBe('unknown');
  });

  it('keeps only a family, never the full string', () => {
    const raw = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.6099.71';
    expect(userAgentFamily(raw)).toBe('chrome');
    expect(userAgentFamily(raw)).not.toContain('537.36');
  });
});
