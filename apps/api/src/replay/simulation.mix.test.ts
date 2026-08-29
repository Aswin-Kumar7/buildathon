import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { SimulationService } from './simulation.service.js';
import { IncidentsService } from '../incidents/incidents.service.js';
import { AttemptsService } from '../attempts/attempts.service.js';

/**
 * The simulation is the demo's centrepiece, so its *shape* is asserted, not just that it runs: a
 * real merchant's traffic is mostly legitimate and diverse, two different card-testing attacks are
 * caught and named differently, and the operational noise (an outage, a biller's dunning) is left
 * alone. `streamAll` is the timed run collapsed to no-wait; the outcome is what a live run reaches.
 */
describe('simulation mix', () => {
  let app: INestApplication;
  let sim: SimulationService;
  let incidents: IncidentsService;
  let attempts: AttemptsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    sim = app.get(SimulationService);
    incidents = app.get(IncidentsService);
    attempts = app.get(AttemptsService);
    await sim.streamAll();
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  it('catches two different attacks, names them apart, and leaves the noise alone', async () => {
    const list = await incidents.list(undefined, 'replay');
    const titles = new Set(list.incidents.map((incident) => incident.title));

    // The loud single-machine burst and the botnet behind one network are both caught, and read
    // as different things to an analyst.
    expect(titles.has('Coordinated card testing')).toBe(true);
    expect(titles.has('Distributed card testing')).toBe(true);
    // Restraint: the outage and the dunning storm are operational, and must not open an incident.
    for (const incident of list.incidents) {
      expect(incident.title).not.toMatch(/gateway|retry|dunning/i);
    }
  });

  it('reads like an actual merchant: mostly legitimate, diverse rails, a minority of attack', async () => {
    const rows = await attempts.listAttemptRows({
      source: 'replay',
      status: 'all',
      method: 'all',
      page: 1,
      pageSize: 200,
    });

    const methods = new Set(rows.rows.map((row) => row.method));
    // Not a wall of test cards — real rails, UPI among them.
    expect(methods.has('upi')).toBe(true);
    expect(methods.size).toBeGreaterThan(1);

    // Most attempts belong to no incident; a minority fall inside the caught attacks. Attempts are
    // never individually scored, so the split is measured by incident membership, not a per-row risk.
    const linked = rows.rows.filter((row) => row.incidentId !== null).length;
    const unlinked = rows.rows.filter((row) => row.incidentId === null).length;
    expect(unlinked).toBeGreaterThan(linked);
    expect(linked).toBeGreaterThan(0);
  });
});
