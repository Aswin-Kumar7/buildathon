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
  claim: 'Detects suspicious failed-payment clusters.',
  version: '0.1.0',
  commit: 'abc1234',
  slice: { number: 1, name: 'Landing page' },
  evidenceLayers: [layer, { ...layer, id: 'L2' as const }, { ...layer, id: 'L3' as const }],
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
});
