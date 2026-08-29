import { describe, expect, it } from 'vitest';
import { metaSchema } from '@sentinel/contracts';
import { MetaController } from './meta.controller.js';
import { ModelMetricsService } from '../model-metrics/model-metrics.service.js';

describe('MetaController', () => {
  it('returns a payload satisfying the shared contract', () => {
    expect(() =>
      metaSchema.parse(new MetaController(new ModelMetricsService()).get()),
    ).not.toThrow();
  });

  it('reports three evidence layers', () => {
    expect(new MetaController(new ModelMetricsService()).get().evidenceLayers).toHaveLength(3);
  });

  it('does not claim any evidence is ready before the slice that produces it', () => {
    const statuses = new MetaController(new ModelMetricsService())
      .get()
      .evidenceLayers.map((layer) => layer.status);
    expect(statuses.every((s) => s === 'not-started')).toBe(true);
  });
});
