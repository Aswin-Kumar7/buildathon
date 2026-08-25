import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { sessions, type DbHandle } from '@sentinel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthService, hashToken } from './auth.service.js';
import { DEMO_USERS, seedDemoUsers } from './seed.js';
import { DB } from '../db/db.module.js';
import { SESSION_COOKIE } from './session.guard.js';

/**
 * These run against PGlite — real Postgres in-process — so the whole auth flow is
 * exercised end to end with no external service and no credentials. That is the same
 * property the credential-free demo path depends on.
 */
describe('auth', () => {
  let app: INestApplication;
  let handle: DbHandle;

  const analyst = { email: 'analyst@test.local', password: 'correct-horse', displayName: 'A' };
  const admin = { email: 'admin@test.local', password: 'correct-horse', displayName: 'B' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    const auth = app.get(AuthService);
    handle = app.get<DbHandle>(DB);
    await auth.createUser({ ...analyst, role: 'analyst' });
    await auth.createUser({ ...admin, role: 'admin' });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password: string) {
    return request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  }

  function cookieFrom(response: request.Response): string {
    const raw = response.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw ?? ''];
    return list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
  }

  it('signs in with correct credentials and returns the user', async () => {
    const response = await login(analyst.email, analyst.password);
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(analyst.email);
    expect(response.body.user.role).toBe('analyst');
    expect(response.body.csrfToken).toEqual(expect.any(String));
  });

  it('sets an httpOnly session cookie', async () => {
    const cookie = cookieFrom(await login(analyst.email, analyst.password));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('never stores the session token in plaintext', async () => {
    const response = await login(analyst.email, analyst.password);
    const token = decodeURIComponent(cookieFrom(response).split(';')[0]?.split('=')[1] ?? '');
    expect(token).not.toBe('');

    const byRawToken = await handle.db.select().from(sessions).where(eq(sessions.id, token));
    expect(byRawToken).toHaveLength(0);

    const byHash = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, hashToken(token)));
    expect(byHash).toHaveLength(1);
  });

  it('rejects a wrong password', async () => {
    const response = await login(analyst.email, 'wrong-password');
    expect(response.status).toBe(401);
  });

  it('gives an unknown email exactly the same response as a wrong password', async () => {
    const unknown = await login('nobody@test.local', 'whatever');
    const wrong = await login(analyst.email, 'wrong-password');
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('rate limits after repeated failures', async () => {
    const email = 'ratelimit@test.local';
    await app.get(AuthService).createUser({ email, displayName: 'C', password: 'right-password' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(email, 'wrong');
    }

    // Correct credentials now, but the window is exhausted.
    const response = await login(email, 'right-password');
    expect(response.status).toBe(401);
  });

  it('reports nobody signed in as a valid answer rather than an error', async () => {
    const response = await request(app.getHttpServer()).get('/api/auth/me');
    expect(response.status).toBe(200);
    expect(response.body.user).toBeNull();
  });

  it('reports the signed-in user', async () => {
    const cookie = cookieFrom(await login(analyst.email, analyst.password));
    const response = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie);
    expect(response.body.user.email).toBe(analyst.email);
  });

  it('refuses a guarded route without a session', async () => {
    const response = await request(app.getHttpServer()).get('/api/auth/session-check');
    expect(response.status).toBe(401);
  });

  it('allows a guarded read with a session', async () => {
    const cookie = cookieFrom(await login(analyst.email, analyst.password));
    const response = await request(app.getHttpServer())
      .get('/api/auth/session-check')
      .set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(analyst.email);
  });

  it('rejects a mutating request that carries the cookie but no CSRF token', async () => {
    const cookie = cookieFrom(await login(admin.email, admin.password));
    const response = await request(app.getHttpServer())
      .post('/api/auth/admin-check')
      .set('Cookie', cookie);
    expect(response.status).toBe(403);
  });

  it('accepts a mutating request with the matching CSRF token', async () => {
    const signedIn = await login(admin.email, admin.password);
    const response = await request(app.getHttpServer())
      .post('/api/auth/admin-check')
      .set('Cookie', cookieFrom(signedIn))
      .set('x-csrf-token', signedIn.body.csrfToken);
    expect(response.status).toBe(200);
  });

  it('denies an analyst on an admin-only route', async () => {
    const signedIn = await login(analyst.email, analyst.password);
    const response = await request(app.getHttpServer())
      .post('/api/auth/admin-check')
      .set('Cookie', cookieFrom(signedIn))
      .set('x-csrf-token', signedIn.body.csrfToken);
    expect(response.status).toBe(403);
  });

  it('seeds the demo accounts even when the table already holds other users', async () => {
    // The regression this guards: seeding used to be skipped whenever the user table was
    // non-empty, so a single unrelated row left the demo accounts uncreated and sign-in
    // answered "Email or password is incorrect" — indistinguishable from a typo. This
    // suite has already inserted two users by the time it runs, which is that state.
    await seedDemoUsers(app.get(AuthService));

    const demo = DEMO_USERS[0]!;
    const response = await login(demo.email, demo.password);
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(demo.email);
  });

  it('creates nothing beyond the demo accounts', async () => {
    // Whether to seed at all is governed by SEED_DEMO_USERS at boot; what this asserts is
    // that seeding never invents an account nobody asked for.
    await seedDemoUsers(app.get(AuthService));
    const response = await login('never-seeded@sentinel.local', 'sentinel-demo');
    expect(response.status).toBe(401);
  });

  it('can be run twice without creating duplicates or changing a password', async () => {
    await seedDemoUsers(app.get(AuthService));
    await seedDemoUsers(app.get(AuthService));

    const demo = DEMO_USERS[0]!;
    expect((await login(demo.email, demo.password)).status).toBe(200);
  });

  it('revokes the session on logout', async () => {
    const signedIn = await login(analyst.email, analyst.password);
    const cookie = cookieFrom(signedIn);

    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', cookie).expect(204);

    const after = await request(app.getHttpServer())
      .get('/api/auth/session-check')
      .set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});
