import { describe, expect, it } from 'vitest';
import { metaSchema } from '@sentinel/contracts';
import { MetaController } from './meta.controller.js';

describe('MetaController', () => {
  it('returns a payload satisfying the shared contract', () => {
    expect(() => metaSchema.parse(new MetaController().get())).not.toThrow();
  });

  it('reports three evidence layers', () => {
    expect(new MetaController().get().evidenceLayers).toHaveLength(3);
  });

  it('does not claim any evidence is ready before the slice that produces it', () => {
    const statuses = new MetaController().get().evidenceLayers.map((layer) => layer.status);
    expect(statuses.every((s) => s === 'not-started')).toBe(true);
  });
});
