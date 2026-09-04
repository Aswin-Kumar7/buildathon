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

describe('policy save and revert', () => {
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

  const live = async () =>
    (await request(app.getHttpServer()).get('/api/policy').set('Cookie', admin.cookie)).body;

  /** The shipped policy at a given version, with a distinguishing containment threshold. */
  const policyAt = (version: number, contain: number) =>
    readFileSync(resolve(process.cwd(), '../../policy.yaml'), 'utf8')
      .replace('version: 1', `version: ${version}`)
      .replace('contain: 0.75', `contain: ${contain}`);

  it('makes a saved policy live immediately, with no approval step', async () => {
    const saved = await post(analyst, '/api/policy/save', { source: policyAt(2, 0.8) });

    expect(saved.status).toBe(201);
    expect(saved.body.version.status).toBe('published');
    const now = await live();
    expect(now.version).toBe(2);
    expect(now.thresholds.contain).toBe(0.8);
  });

  it('refuses a version number that is not the next one', async () => {
    // v2 is taken by the save above; re-sending it must not silently overwrite history.
    expect((await post(analyst, '/api/policy/save', { source: policyAt(2, 0.85) })).status).toBe(
      400,
    );
  });

  it('restores an earlier version by writing it forward, leaving history intact', async () => {
    const listBefore = await request(app.getHttpServer())
      .get('/api/policy/versions')
      .set('Cookie', admin.cookie);
    const target = listBefore.body.versions.find(
      (version: { version: number }) => version.version === 2,
    );

    // Move away from v2, so reverting to it is a real change with an observable difference.
    expect((await post(analyst, '/api/policy/save', { source: policyAt(3, 0.9) })).status).toBe(
      201,
    );
    expect((await live()).thresholds.contain).toBe(0.9);

    const reverted = await post(analyst, `/api/policy/versions/${target.id}/revert`);
    expect(reverted.status).toBe(201);
    // Forward-only: a NEW version carrying the old settings, never an edit of the old row.
    expect(reverted.body.version.version).toBe(4);
    const now = await live();
    expect(now.version).toBe(4);
    expect(now.thresholds.contain).toBe(0.8);

    const listAfter = await request(app.getHttpServer())
      .get('/api/policy/versions')
      .set('Cookie', admin.cookie);
    expect(listAfter.body.versions.length).toBe(listBefore.body.versions.length + 2);
    // The original row is untouched: reverting adds history, it never rewrites it.
    const original = listAfter.body.versions.find(
      (version: { id: string }) => version.id === target.id,
    );
    expect(original.hash).toBe(target.hash);
    expect(original.version).toBe(2);
  });

  it('refuses to revert to the version that is already live', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/policy/versions')
      .set('Cookie', admin.cookie);
    const current = (await live()).hash;
    const same = list.body.versions.find((version: { hash: string }) => version.hash === current);
    expect((await post(analyst, `/api/policy/versions/${same.id}/revert`)).status).toBe(409);
  });
});
