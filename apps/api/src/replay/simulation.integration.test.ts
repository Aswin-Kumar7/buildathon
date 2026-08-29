import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { canonicalEvents, inboxEvents, type DbHandle } from '@sentinel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { SimulationService } from './simulation.service.js';

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('simulation', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let simulation: SimulationService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    handle = app.get<DbHandle>(DB);
    simulation = app.get(SimulationService);
  }, 90_000);

  afterAll(async () => {
    await simulation.stop();
    await app.close();
  });

  it('streams synthetic transactions through the real ingestion path, then stops', async () => {
    const started = await simulation.start();
    expect(started.running).toBe(true);
    expect(started.total).toBeGreaterThan(0);

    // Poll until at least one transaction has emitted. The emit loop is fast; a separate loop
    // drains the inbox to canonical, so the proof of the real path — sealed, drained, redacted, like
    // live traffic — arrives a beat later, which is what the second poll waits for.
    const deadline = Date.now() + 18_000;
    while ((await simulation.status()).emitted === 0 && Date.now() < deadline) {
      await wait(500);
    }
    expect((await simulation.status()).emitted).toBeGreaterThan(0);

    const inbox = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.source, 'replay'));
    expect(inbox.length).toBeGreaterThan(0);

    let canonical: unknown[] = [];
    const canonicalDeadline = Date.now() + 12_000;
    while (canonical.length === 0 && Date.now() < canonicalDeadline) {
      canonical = await handle.db
        .select()
        .from(canonicalEvents)
        .where(eq(canonicalEvents.source, 'replay'));
      if (canonical.length === 0) await wait(500);
    }
    expect(canonical.length).toBeGreaterThan(0);

    const stopped = await simulation.stop();
    expect(stopped.running).toBe(false);
    expect((await simulation.status()).running).toBe(false);
  }, 30_000);

  it('is a no-op to start twice — the second call returns the run already in flight', async () => {
    const first = await simulation.start();
    const second = await simulation.start();
    expect(second.running).toBe(true);
    expect(second.total).toBe(first.total);
    await simulation.stop();
  });
});
