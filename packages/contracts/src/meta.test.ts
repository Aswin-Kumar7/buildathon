import { describe, expect, it } from 'vitest';
import { metaSchema } from './meta.js';

const layer = {
  id: 'L1' as const,
  name: 'Integration',
  source: 'Razorpay test mode',
  proves: 'The ingestion contract works',
  status: 'not-started' as const,
  arrivesIn: 'Slice 4',
};

const valid = {
  name: 'Sentinel' as const,
  storefrontUrl: 'https://shop.example.com/',
  claim: 'Detects suspicious failed-payment clusters.',
  version: '0.1.0',
  commit: 'abc1234',
  slice: { number: 1, name: 'Landing page' },
  evidenceLayers: [layer, { ...layer, id: 'L2' as const }, { ...layer, id: 'L3' as const }],
  model: { prAuc: 0.94, recall: 0.97, falseDeclineRate: 0.1 },
};

describe('metaSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(metaSchema.parse(valid)).toEqual(valid);
  });

  it('requires exactly three evidence layers', () => {
    expect(() => metaSchema.parse({ ...valid, evidenceLayers: [layer] })).toThrow();
  });

  it('rejects an unknown evidence status', () => {
    const bad = { ...valid, evidenceLayers: [{ ...layer, status: 'done' }, layer, layer] };
    expect(() => metaSchema.parse(bad)).toThrow();
  });

  it('rejects a negative slice number', () => {
    expect(() => metaSchema.parse({ ...valid, slice: { number: -1, name: 'x' } })).toThrow();
  });

  it('accepts no configured storefront, so a deployment may leave it unset', () => {
    expect(metaSchema.parse({ ...valid, storefrontUrl: null }).storefrontUrl).toBeNull();
  });

  it('rejects a storefront address that is not a url', () => {
    // The web client renders this straight into an href, so a bare hostname or a stray path
    // fragment has to fail here rather than produce a link that resolves against the API.
    expect(() => metaSchema.parse({ ...valid, storefrontUrl: 'shop.example.com' })).toThrow();
  });
});
