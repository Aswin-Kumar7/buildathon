import { describe, expect, it, vi } from 'vitest';
import { CopilotService } from './copilot.service.js';
import type { IncidentsService } from '../incidents/incidents.service.js';
import type { ContainmentService } from '../containment/containment.service.js';

const noContainment = { preview: () => Promise.resolve(null) } as unknown as ContainmentService;

/**
 * The copilot is LLM-only: with no model configured it must return an honest "unavailable" rather
 * than fabricate an answer, and it must load the incident first so a bad id fails before any model
 * call. Both are checked here without touching the network.
 */
describe('CopilotService', () => {
  it('returns an honest unavailable — never a fabricated answer — when the model is not configured', async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      const incidents = { detail: vi.fn(async () => ({}) as never) } as unknown as IncidentsService;
      const service = new CopilotService(incidents, noContainment);

      const result = await service.ask('inc-1', 'Why is this risky?');

      expect(result).toEqual({ incidentId: 'inc-1', available: false, answer: '' });
      expect(incidents.detail).toHaveBeenCalledWith('inc-1');
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });

  it('propagates a missing incident instead of answering', async () => {
    const incidents = {
      detail: vi.fn(async () => {
        throw new Error('incident not found');
      }),
    } as unknown as IncidentsService;
    const service = new CopilotService(incidents, noContainment);

    await expect(service.ask('missing', 'anything')).rejects.toThrow('incident not found');
  });
});
