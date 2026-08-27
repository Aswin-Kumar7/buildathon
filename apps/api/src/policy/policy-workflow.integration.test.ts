import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';

describe('policy workflow', () => {
  let app: INestApplication;
  let analyst: { cookie: string; csrf: string };
  let admin: { cookie: string; csrf: string };

  async function signIn(email: string, role: 'analyst' | 'admin') {
    await app
      .get(AuthService)
      .createUser({ email, password: 'correct-horse', displayName: role, role });
    const result = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'correct-horse' });
    const cookies = result.headers['set-cookie'] as unknown as string[];
    return {
      cookie: cookies.find((value) => value.startsWith(SESSION_COOKIE)) ?? '',
      csrf: result.body.csrfToken as string,
    };
  }

  const post = (person: { cookie: string; csrf: string }, path: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', person.cookie)
      .set(CSRF_HEADER, person.csrf)
      .send(body ?? {});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
    analyst = await signIn('policy-analyst@test.local', 'analyst');
    admin = await signIn('policy-admin@test.local', 'admin');
  });

  afterAll(async () => app.close());

  it('requires a second admin-controlled approval before publishing a validated version', async () => {
    const source = readFileSync(resolve(process.cwd(), '../../policy.yaml'), 'utf8').replace(
      'version: 1',
      'version: 2',
    );
    const draft = await post(analyst, '/api/policy/drafts', { source });
    expect(draft.status).toBe(201);
    const id = draft.body.version.id as string;

    expect((await post(analyst, `/api/policy/versions/${id}/submit`)).status).toBe(201);
    expect((await post(analyst, `/api/policy/versions/${id}/approve`)).status).toBe(403);
    expect((await post(admin, `/api/policy/versions/${id}/approve`)).status).toBe(201);
    const published = await post(admin, `/api/policy/versions/${id}/publish`);
    expect(published.status).toBe(201);
    expect(published.body.version.status).toBe('published');
    expect(
      (await request(app.getHttpServer()).get('/api/policy').set('Cookie', admin.cookie)).body
        .version,
    ).toBe(2);
  });
});
