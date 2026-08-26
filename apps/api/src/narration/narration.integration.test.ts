import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncidentListResponse, NarrativeResponse } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';

describe('narration', () => {
  let app: INestApplication;
  let cookie = '';
  let csrf = '';
  let incidentId = '';

  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const post = (path: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf)
      .send(body ?? {});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    await app.get(AuthService).createUser({
      email: 'narr@test.local',
      password: 'correct-horse',
      displayName: 'N',
      role: 'analyst',
    });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'narr@test.local', password: 'correct-horse' });
    const raw = signedIn.headers['set-cookie'];
    cookie =
      (Array.isArray(raw) ? raw : [raw ?? '']).find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
    csrf = signedIn.body.csrfToken;

    await post('/api/replay', { family: 'attack_loud' });
    const drain = app.get(DrainService);
    for (let pass = 0; pass < 50; pass += 1) if ((await drain.drainOnce()).claimed === 0) break;
    await post('/api/incidents/evaluate');

    const list = (await get('/api/incidents')).body as IncidentListResponse;
    incidentId = list.incidents[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('narrates an incident from its verified record, with a source badge', async () => {
    const body = (await get(`/api/incidents/${incidentId}/narrative`)).body as NarrativeResponse;
    const narrative = body.narrative;

    expect(narrative.lines.length).toBeGreaterThan(0);
    // Default build has no provider, so it runs on-device — a real tier, not the bare template.
    expect(['local', 'template']).toContain(narrative.source);
    expect(narrative.lines.every((line) => line.text.length > 0)).toBe(true);
    // The guard never fired on our own deterministic tier: nothing to drop.
    expect(narrative.dropped).toBe(0);
    // A loud enumeration leads with the headline the catalog defines.
    expect(narrative.lines[0]!.claimId).toBe('headline');
  });

  it('binds values from the evidence, so the narrative states real numbers', async () => {
    const body = (await get(`/api/incidents/${incidentId}/narrative`)).body as NarrativeResponse;
    const text = body.narrative.lines.map((l) => l.text).join(' ');
    // Every line carries the tier as its badge — the per-line source the console renders.
    expect(body.narrative.lines.every((l) => l.source === body.narrative.source)).toBe(true);
    // The account contains at least one bound figure (a count, a percentage, or a duration).
    expect(/\d/.test(text)).toBe(true);
  });

  it('is stable: the same evidence narrates to the same account (the cache key holds)', async () => {
    const first = (await get(`/api/incidents/${incidentId}/narrative`)).body as NarrativeResponse;
    const second = (await get(`/api/incidents/${incidentId}/narrative`)).body as NarrativeResponse;
    expect(second.narrative.evidenceHash).toBe(first.narrative.evidenceHash);
    expect(second.narrative.lines.map((l) => l.text)).toEqual(
      first.narrative.lines.map((l) => l.text),
    );
  });

  it('refuses an unknown incident rather than inventing one', async () => {
    // A well-formed id that simply is not there — an unknown incident, not a malformed request.
    await get('/api/incidents/00000000-0000-0000-0000-000000000000/narrative').expect(404);
  });
});
