import { describe, expect, it } from 'vitest';
import { healthSchema } from '@sentinel/contracts';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns a payload satisfying the shared contract', () => {
    const result = new HealthController().get();
    expect(() => healthSchema.parse(result)).not.toThrow();
  });

  it('reports ok', () => {
    expect(new HealthController().get().status).toBe('ok');
  });

  it('returns a stable startedAt across calls', () => {
    const controller = new HealthController();
    expect(controller.get().startedAt).toBe(controller.get().startedAt);
  });
});
