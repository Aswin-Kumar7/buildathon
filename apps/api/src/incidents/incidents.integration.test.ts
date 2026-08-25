import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncidentDetailResponse, IncidentListResponse } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';

interface Harness {
  app: INestApplication;
  cookie: string;
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
}

async function boot(families: readonly string[], email: string): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.init();

  await app
    .get(AuthService)
    .createUser({ email, password: 'correct-horse', displayName: 'Ana', role: 'analyst' });
  const signedIn = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'correct-horse' });
  const raw = signedIn.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw ?? ''];
  const cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
  const csrf = signedIn.body.csrfToken as string;

  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const post = (path: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf)
      .send(body ?? {});

  for (const family of families) {
    expect((await post('/api/replay', { family })).status, family).toBe(200);
  }

  const drain = app.get(DrainService);
  for (let pass = 0; pass < 50; pass += 1) {
    if ((await drain.drainOnce()).claimed === 0) break;
  }

  return { app, cookie, get, post };
}

describe('incidents', () => {
  let h: Harness;

  beforeAll(async () => {
    // One family, on purpose. The feature window anchors to the newest event in the store, and
    // the corpus families span five, forty-nine and a hundred and nineteen minutes from the
    // same instant — so replaying all three into one database leaves only the longest inside
    // the window. Mixing them here would have tested an accident of the corpus.
    h = await boot(['attack_loud'], 'incidents@test.local');
    expect((await h.post('/api/incidents/evaluate')).status).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
  });

  it('needs a session', async () => {
    expect((await request(h.app.getHttpServer()).get('/api/incidents')).status).toBe(401);
  });

  it('turns a replayed attack into exactly one incident', async () => {
    // The slice's exit condition, through the whole stack: replay, ingest, redact, resolve,
    // features, rules, cluster. Sixty alerts for one burst would be a worse product than none —
    // and so would three, one per correlation key, for a machine that has one of each.
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;

    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0]!.firedRules).toContain('card_spread');
    expect(body.incidents[0]!.severity).toBe('high');
    // The narrowest key that explains it: containing one session is a smaller act than
    // containing a network.
    expect(body.incidents[0]!.entityKind).toBe('session');
  });

  it('opens nothing below the floor', async () => {
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;

    expect(body.incidents.length).toBeGreaterThan(0);
    expect(body.incidents.every((i) => i.score >= 0.4)).toBe(true);
    expect(body.incidents.every((i) => i.band !== 'low')).toBe(true);
  });

  it('does not expire a replayed incident the moment it opens', async () => {
    // Expiry is measured against the moment the pass judged as of, not the wall clock. The
    // corpus carries timestamps from months ago, so using `now()` made every replayed incident
    // arrive already expired — and `expired` is terminal, so the analyst got a queue of things
    // they could not touch.
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;

    expect(body.incidents.some((i) => i.status === 'open')).toBe(true);
  });

  it('is idempotent — a second pass updates rather than duplicates', async () => {
    const before = (await h.get('/api/incidents')).body as IncidentListResponse;
    const second = await h.post('/api/incidents/evaluate');
    const after = (await h.get('/api/incidents')).body as IncidentListResponse;

    expect(second.body.opened).toBe(0);
    expect(second.body.updated).toBeGreaterThan(0);
    expect(after.incidents).toHaveLength(before.incidents.length);
    expect(after.incidents[0]!.key).toBe(before.incidents[0]!.key);
  });

  it('says which threshold set judged it', async () => {
    // A score without the thresholds that produced it is a number nobody can argue with.
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;
    expect(body.thresholdHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('carries the evidence, the mitigations and what could not be judged', async () => {
    const list = (await h.get('/api/incidents')).body as IncidentListResponse;
    const detail = (await h.get(`/api/incidents/${list.incidents[0]!.id}`))
      .body as IncidentDetailResponse;

    expect(detail.incident.evidence.length).toBeGreaterThan(0);
    // Codes and numbers, never prose. The sentence is rendered in the console from these.
    for (const item of detail.incident.evidence) {
      expect(item.code).toMatch(/^[a-z0-9_]+$/);
      expect(Number.isFinite(item.observed)).toBe(true);
    }
    expect(detail.incident.thresholdHash).toBe(list.thresholdHash);
    expect(Array.isArray(detail.incident.abstentions)).toBe(true);
  });

  it('labels an incident by where its events came from, not by what was asked for', async () => {
    // Everything here arrived through replay, and the pass ran with the default scope of both.
    // Labelling it `razorpay` would present synthetic traffic as a real detection — the one
    // thing this system claims it never does. It was doing exactly that, because the label came
    // from the query rather than from the data.
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;

    expect(body.incidents.length).toBeGreaterThan(0);
    expect(body.incidents.every((i) => i.source === 'replay')).toBe(true);
  });

  it('says nothing about change when there is no history to compare against', async () => {
    // This burst lasts five minutes. There is no baseline it could have departed from, and a
    // detector run on its own warm-up would be reporting on nothing — so it reports nothing.
    const list = (await h.get('/api/incidents')).body as IncidentListResponse;
    const detail = (await h.get(`/api/incidents/${list.incidents[0]!.id}`))
      .body as IncidentDetailResponse;

    expect(detail.incident.change).toBeNull();
  });

  it('does not expire the queue when a pass finds nothing to look at', async () => {
    // Found by the end-to-end suite, and a real defect rather than a test artifact. Evaluating a
    // scope with no events fell back to the wall clock, and every incident recorded against
    // historical timestamps is "idle" by that reckoning — so one empty pass closed the whole
    // queue, irreversibly, because `expired` is terminal.
    const before = (await h.get('/api/incidents')).body as IncidentListResponse;
    expect(before.incidents.some((i) => i.status !== 'expired')).toBe(true);

    // Nothing here arrived as real traffic, so this pass has nothing to judge.
    const empty = await h.post('/api/incidents/evaluate?source=razorpay');
    expect(empty.body.evaluated).toBe(0);
    expect(empty.body.expired).toBe(0);

    const after = (await h.get('/api/incidents')).body as IncidentListResponse;
    expect(after.incidents.map((i) => i.status)).toEqual(before.incidents.map((i) => i.status));
  });

  it('measures time-to-detect from the attempt rather than the pass', async () => {
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;
    const incident = body.incidents[0]!;

    expect(incident.timeToDetectMs).toBe(incident.detectedAt - incident.firstAttemptAt);
    expect(incident.timeToDetectMs).toBeGreaterThanOrEqual(0);
  });

  it('records who moved it, and when', async () => {
    const list = (await h.get('/api/incidents')).body as IncidentListResponse;
    const id = list.incidents[0]!.id;

    const reviewed = await h.post(`/api/incidents/${id}/transition`, {
      to: 'under_review',
      note: 'checking the card list',
    });

    expect(reviewed.status).toBe(201);
    const detail = reviewed.body as IncidentDetailResponse;
    expect(detail.incident.status).toBe('under_review');
    expect(detail.incident.history).toHaveLength(1);
    expect(detail.incident.history[0]).toMatchObject({
      from: 'open',
      to: 'under_review',
      actor: 'Ana',
      note: 'checking the card list',
    });
  });

  it('refuses an illegal move rather than silently ignoring it', async () => {
    // An analyst who thinks they contained something and did not is worse off than one who
    // got an error.
    const list = (await h.get('/api/incidents')).body as IncidentListResponse;
    const id = list.incidents[0]!.id;

    expect((await h.post(`/api/incidents/${id}/transition`, { to: 'resolved' })).status).toBe(201);
    const reopened = await h.post(`/api/incidents/${id}/transition`, { to: 'open' });

    expect(reopened.status).toBe(400);
    expect(reopened.body.message).toMatch(/cannot go from resolved to open/);
  });

  it('does not let a detection pass undo an analyst', async () => {
    // The pass recomputes scores, not status. Resetting `under_review` back to `open` every
    // time the detector ran would quietly throw away somebody's work.
    const before = (await h.get('/api/incidents')).body as IncidentListResponse;
    const resolved = before.incidents.filter((i) => i.status === 'resolved').map((i) => i.key);
    expect(resolved.length).toBeGreaterThan(0);

    await h.post('/api/incidents/evaluate');
    const after = (await h.get('/api/incidents')).body as IncidentListResponse;

    for (const key of resolved) {
      expect(after.incidents.find((i) => i.key === key)?.status, key).toBe('resolved');
    }
  });

  it('counts by status, and filters by it', async () => {
    const body = (await h.get('/api/incidents')).body as IncidentListResponse;
    expect(body.counts.resolved).toBeGreaterThan(0);

    const filtered = (await h.get('/api/incidents?status=resolved')).body as IncidentListResponse;
    expect(filtered.incidents.every((i) => i.status === 'resolved')).toBe(true);
    expect(filtered.incidents).toHaveLength(body.counts.resolved);
  });

  it('answers 404 for an incident that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await h.get(`/api/incidents/${missing}`)).status).toBe(404);
  });

  it('refuses a transition carrying the cookie but no CSRF token', async () => {
    const list = (await h.get('/api/incidents')).body as IncidentListResponse;
    const response = await request(h.app.getHttpServer())
      .post(`/api/incidents/${list.incidents[0]!.id}/transition`)
      .set('Cookie', h.cookie)
      .send({ to: 'under_review' });

    expect(response.status).toBe(403);
  });
});

describe('incidents, the cases that must not open one', () => {
  /**
   * The expensive mistakes, each in its own database for the same reason as above: a merchant
   * stopped from collecting money it is owed, and customers punished for an acquirer being down.
   */
  const quiet = ['retry_storm', 'gateway_outage', 'flash_sale', 'customer_error'] as const;

  for (const family of quiet) {
    it(`opens nothing for ${family}`, async () => {
      const h = await boot([family], `incidents-${family}@test.local`);
      try {
        await h.post('/api/incidents/evaluate');
        const body = (await h.get('/api/incidents')).body as IncidentListResponse;

        expect(
          body.incidents.map((i) => `${i.entityKey}=${i.score}`),
          family,
        ).toHaveLength(0);
      } finally {
        await h.app.close();
      }
    }, 180_000);
  }
});

describe('incidents, change detection with real history', () => {
  /**
   * The low-amplitude attack runs for over an hour, which is the only way change detection has
   * anything to say: it needs a baseline before it can report a departure from one.
   *
   * This is also the test that would have caught the alarm being computed from a two-element
   * series — the first and last attempt — which could never have fired. Nothing asserted on the
   * change result at all, so nothing noticed that Tier 2 was wired to nothing.
   */
  let h: Harness;

  beforeAll(async () => {
    h = await boot(['attack_low_amplitude'], 'incidents-change@test.local');
    await h.post('/api/incidents/evaluate');
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
  });

  it('learns a baseline from real arrival times and reports a departure from it', async () => {
    const list = (await h.get('/api/incidents')).body as IncidentListResponse;
    expect(list.incidents.length).toBeGreaterThan(0);

    const detail = (await h.get(`/api/incidents/${list.incidents[0]!.id}`))
      .body as IncidentDetailResponse;
    expect(detail.incident.change).not.toBeNull();

    const change = detail.incident.change!;
    expect(change.baseline.buckets).toBeGreaterThan(2);
    expect(change.baseline.deviation).toBeGreaterThan(0);
    // A fired alarm has to carry the numbers that justify it, or it is an assertion nobody can
    // check.
    if (change.cusum.fired) {
      expect(change.cusum.statistic).toBeGreaterThan(change.cusum.limit);
      expect(change.cusum.buckets).toBeGreaterThan(0);
    }
    if (change.ewma.fired) expect(change.ewma.statistic).toBeGreaterThan(change.ewma.limit);
  });
});
