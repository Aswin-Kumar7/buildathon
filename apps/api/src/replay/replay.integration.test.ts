import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  canonicalEvents,
  checkoutSessions,
  incidents,
  inboxEvents,
  type DbHandle,
} from '@sentinel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';
import { assertReplayAllowed, ReplayService } from './replay.service.js';

describe('replay', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let drain: DrainService;
  let cookie = '';
  let csrf = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    handle = app.get<DbHandle>(DB);
    drain = app.get(DrainService);

    const analyst = { email: 'replay@test.local', password: 'correct-horse', displayName: 'R' };
    await app.get(AuthService).createUser({ ...analyst, role: 'analyst' });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: analyst.email, password: analyst.password });
    const raw = signedIn.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw ?? ''];
    cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
    // Replay mutates state, so it goes through the double-submit CSRF check like every other
    // mutating route. The cookie alone is deliberately not enough.
    csrf = signedIn.body.csrfToken;
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  const run = (family: string) =>
    request(app.getHttpServer())
      .post('/api/replay')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf)
      .send({ family });

  it('needs a session', async () => {
    expect((await request(app.getHttpServer()).get('/api/replay')).status).toBe(401);
  });

  it('lists every scenario with the labels it was registered with', async () => {
    const response = await request(app.getHttpServer()).get('/api/replay').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.scenarios).toHaveLength(11);

    const families = response.body.scenarios.map((s: { family: string }) => s.family);
    expect(families).toContain('attack_distributed');
    expect(families).toContain('retry_storm');
    // The added attack shapes, so the demo's incident feed shows the detector's range.
    expect(families).toContain('attack_carding');
    expect(families).toContain('attack_proxy');
    expect(families).toContain('attack_partial');

    const dunning = response.body.scenarios.find(
      (s: { family: string }) => s.family === 'retry_storm',
    );
    expect(dunning.classification).toBe('operational');
    expect(dunning.recommendedAction).toMatch(/nothing|note/i);
  });

  it('writes a scenario through the real ingestion path', async () => {
    const response = await run('attack_loud');

    expect(response.status).toBe(200);
    expect(response.body.eventsWritten).toBeGreaterThan(50);
    expect(response.body.checkoutsWritten).toBeGreaterThan(50);
  });

  it('marks everything it wrote as synthetic', async () => {
    // The property that keeps a demo from contaminating the evidence. Without it, "events
    // stored" on the health page would count invented traffic as proof the system works.
    const events = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.source, 'replay'));

    expect(events.length).toBeGreaterThan(50);
    expect(events.every((row) => row.source === 'replay')).toBe(true);
  });

  it('carries the synthetic marking through redaction', async () => {
    await drain.drainOnce();

    const canonical = await handle.db
      .select()
      .from(canonicalEvents)
      .where(eq(canonicalEvents.source, 'replay'));

    expect(canonical.length).toBeGreaterThan(0);
    expect(canonical.every((row) => row.source === 'replay')).toBe(true);
  });

  it('encrypts a replayed payload exactly as a real one', async () => {
    // The replay exercises the real path or it tests nothing.
    const [row] = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.source, 'replay'));

    expect(row?.ciphertext).toBeTruthy();
    expect(row?.wrappedKey).toBeTruthy();

    // Something that exists only inside the payload. `event_type` is a plaintext column on
    // purpose — metrics need it and it names no one — so asserting on that would have passed
    // whether the body was encrypted or not.
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('Simulated decline');
    expect(stored).not.toContain('pay_SIM');
    expect(stored).not.toContain('error_reason');
  });

  it('writes the checkout context, so correlation keys exist to detect on', async () => {
    const checkouts = await handle.db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.source, 'replay'));

    expect(checkouts.length).toBeGreaterThan(50);
    // Pseudonymised through the same functions the storefront uses, not stored raw.
    expect(checkouts[0]?.sessionPseudonym).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(JSON.stringify(checkouts)).not.toContain('sess_SIM');
  });

  it('is idempotent — replaying the same scenario twice adds nothing', async () => {
    const before = (await handle.db.select().from(inboxEvents)).length;
    const second = await run('attack_loud');

    expect(second.body.eventsWritten).toBe(0);
    expect(second.body.duplicatesSkipped).toBeGreaterThan(50);
    expect((await handle.db.select().from(inboxEvents)).length).toBe(before);
  });

  it('refuses a scenario it has never heard of', async () => {
    expect((await run('attack_by_wizards')).status).toBe(404);
  });

  it('refuses a mutating replay that carries the cookie but no CSRF token', async () => {
    // Replay writes to the database, so it is behind the same double-submit check as every
    // other mutating route. A console page that could be triggered from another origin would
    // be a way to fill somebody's database with invented traffic.
    const response = await request(app.getHttpServer())
      .post('/api/replay')
      .set('Cookie', cookie)
      .send({ family: 'attack_loud' });

    expect(response.status).toBe(403);
  });

  it('removes only what it wrote', async () => {
    // Scoped by source. A demo that could delete real events would be worse than one that
    // leaves clutter behind.
    await handle.db.insert(inboxEvents).values({
      razorpayEventId: 'evt_REAL_KEEPME',
      eventType: 'payment.captured',
      eventAt: new Date(),
    });

    const cleared = await request(app.getHttpServer())
      .delete('/api/replay')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf);
    expect(cleared.status).toBe(200);
    expect(cleared.body.removed).toBeGreaterThan(50);

    const left = await handle.db.select().from(inboxEvents);
    expect(left.map((row) => row.razorpayEventId)).toContain('evt_REAL_KEEPME');
    expect(left.every((row) => row.source === 'razorpay')).toBe(true);
  });

  it('wipes everything, both sources, on a full reset', async () => {
    // Unlike the scoped clear, a full reset is the demo control that takes real events too.
    await handle.db.insert(inboxEvents).values({
      razorpayEventId: 'evt_RESET_ME',
      eventType: 'payment.captured',
      eventAt: new Date(),
    });

    const reset = await request(app.getHttpServer())
      .delete('/api/replay/all')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf);
    expect(reset.status).toBe(200);
    expect(reset.body.removed).toBeGreaterThan(0);

    expect(await handle.db.select().from(inboxEvents)).toHaveLength(0);
  });

  it('accumulates scenarios and resets only the one re-run', async () => {
    // The board keeps incidents from every scenario, and re-running one replaces only its own
    // rows — what the simulation controller does per run via clearFamily(family). Different
    // scenarios accumulate; the same scenario resets. Start from a clean slate to count cleanly.
    await request(app.getHttpServer())
      .delete('/api/replay/all')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf);

    await run('attack_loud');
    await run('attack_distributed');

    // Every row a scenario wrote is tagged with that scenario.
    const wroteLoud = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.family, 'attack_loud'));
    const wroteDistributed = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.family, 'attack_distributed'));
    expect(wroteLoud.length).toBeGreaterThan(0);
    expect(wroteDistributed.length).toBeGreaterThan(0);

    // Resetting one scenario removes only its rows; the other scenario stays.
    await app.get(ReplayService).clearFamily('attack_loud');

    const loudLeft = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.family, 'attack_loud'));
    const distributedLeft = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.family, 'attack_distributed'));
    expect(loudLeft).toHaveLength(0);
    expect(distributedLeft.length).toBeGreaterThan(0);

    // Incidents are scoped the same way: none of the reset scenario's incidents remain.
    const replayIncidents = await handle.db
      .select()
      .from(incidents)
      .where(eq(incidents.source, 'replay'));
    expect(replayIncidents.every((row) => row.family !== 'attack_loud')).toBe(true);
  });
});

/**
 * Tested as a rule rather than through a booted application. Under NODE_ENV=production the
 * environment schema refuses to start without a real database, so an app-level test would
 * never reach this guard — it would be asserting on the wrong refusal.
 */
describe('replay in production', () => {
  it('is refused by default', () => {
    // A deployment whose numbers are cited as evidence must not be able to accept invented
    // traffic, whatever anyone types into a console.
    expect(() => assertReplayAllowed('production')).toThrow(/production/i);
    expect(() => assertReplayAllowed('production', false)).toThrow(/production/i);
  });

  it('names the way out rather than just refusing', () => {
    // Somebody hitting this on the hosted demo should learn what to set, not just that they lost.
    expect(() => assertReplayAllowed('production')).toThrow(/ALLOW_REPLAY_IN_PRODUCTION/);
  });

  it('runs in production only when a deployment opts in by name', () => {
    // The demo instance sets this. It is deliberately not inferred from anything else, so no
    // combination of other settings can switch it on by accident.
    expect(() => assertReplayAllowed('production', true)).not.toThrow();
  });

  it('is allowed everywhere else', () => {
    expect(() => assertReplayAllowed('development')).not.toThrow();
    expect(() => assertReplayAllowed('test')).not.toThrow();
  });
});
