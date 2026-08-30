import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MeResponse, WorkspaceResponse } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';

interface Session {
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
}

describe('settings', () => {
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
      email: 'ws@test.local',
      displayName: 'Workspace',
      password: 'correct-horse',
      role: 'admin',
    });
    await auth.createUser({
      email: 'prof@test.local',
      displayName: 'Before',
      password: 'correct-horse',
      role: 'analyst',
    });
    await auth.createUser({
      email: 'pw@test.local',
      displayName: 'Passworder',
      password: 'correct-horse',
      role: 'analyst',
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('reports real workspace config, not hand-typed strings', async () => {
    const session = await signIn('ws@test.local', 'correct-horse');
    const body = (await session.get('/api/workspace')).body as WorkspaceResponse;

    expect(body.currency).toBe('INR');
    expect(body.retentionDays).toBeGreaterThan(0);
    expect(body.sessionHours).toBeGreaterThan(0);
    expect(body.loginMaxAttempts).toBeGreaterThan(0);
    expect(typeof body.ai.enabled).toBe('boolean');
  });

  it('updates your own name and access level, and it sticks', async () => {
    const session = await signIn('prof@test.local', 'correct-horse');

    const updated = await session.post('/api/auth/profile', {
      displayName: 'After',
      role: 'admin',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.user.displayName).toBe('After');
    expect(updated.body.user.role).toBe('admin');

    // The change is authoritative: /me reflects the new name and role.
    const me = (await session.get('/api/auth/me')).body as MeResponse;
    expect(me.user?.displayName).toBe('After');
    expect(me.user?.role).toBe('admin');
  });

  it('rejects an empty profile update', async () => {
    const session = await signIn('prof@test.local', 'correct-horse');
    expect((await session.post('/api/auth/profile', {})).status).toBe(400);
  });

  it('changes a password only with the correct current one', async () => {
    const session = await signIn('pw@test.local', 'correct-horse');
    expect(
      (
        await session.post('/api/auth/password', {
          currentPassword: 'wrong',
          newPassword: 'brand-new-pass',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await session.post('/api/auth/password', {
          currentPassword: 'correct-horse',
          newPassword: 'brand-new-pass',
        })
      ).status,
    ).toBe(200);
    const relog = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'pw@test.local', password: 'brand-new-pass' });
    expect(relog.status).toBe(200);
  });
});
