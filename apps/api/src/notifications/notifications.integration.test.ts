import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationPrefs } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';

interface Session {
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
}

describe('notifications', () => {
  let app: INestApplication;

  async function signIn(email: string, password: string): Promise<Session> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw ?? ''];
    const cookie = list.find((entry) => entry.startsWith(SESSION_COOKIE)) ?? '';
    const csrf = res.body.csrfToken as string;
    return {
      get: (path) => request(app.getHttpServer()).get(path).set('Cookie', cookie),
      post: (path, body) =>
        request(app.getHttpServer())
          .post(path)
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrf)
          .send(body ?? {}),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    const auth = app.get(AuthService);
    await auth.createUser({
      email: 'notif@test.local',
      displayName: 'Notify',
      password: 'correct-horse',
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('starts every user with sensible defaults', async () => {
    const session = await signIn('notif@test.local', 'correct-horse');
    const prefs = (await session.get('/api/notifications/prefs')).body as NotificationPrefs;

    expect(prefs.minSeverity).toBe('low');
    expect(prefs.simulated).toBe(true);
    expect(prefs.seenAt).toBeNull();
  });

  it('persists a preference change', async () => {
    const session = await signIn('notif@test.local', 'correct-horse');

    const updated = await session.post('/api/notifications/prefs', {
      minSeverity: 'high',
      simulated: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.minSeverity).toBe('high');
    expect(updated.body.simulated).toBe(false);

    // A fresh read reflects it — the change is stored, not held in the response only.
    const reread = (await session.get('/api/notifications/prefs')).body as NotificationPrefs;
    expect(reread.minSeverity).toBe('high');
    expect(reread.simulated).toBe(false);
  });

  it('rejects an empty preference change', async () => {
    const session = await signIn('notif@test.local', 'correct-horse');
    expect((await session.post('/api/notifications/prefs', {})).status).toBe(400);
  });

  it('marks notifications read with a server-set timestamp', async () => {
    const session = await signIn('notif@test.local', 'correct-horse');

    const before = (await session.get('/api/notifications/prefs')).body as NotificationPrefs;
    const seen = await session.post('/api/notifications/seen');
    expect(seen.status).toBe(200);
    expect(seen.body.seenAt).not.toBeNull();

    // The watermark only ever moves forward in time.
    const after = Date.parse(seen.body.seenAt as string);
    expect(Number.isNaN(after)).toBe(false);
    if (before.seenAt !== null) expect(after).toBeGreaterThanOrEqual(Date.parse(before.seenAt));
  });
});
