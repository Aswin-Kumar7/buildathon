import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { containments, incidents, type DbHandle } from '@sentinel/db';
import type { EnforcementState } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DB } from '../db/db.module.js';
import { ContainmentService } from '../containment/containment.service.js';
import { EnforcementService } from './enforcement.service.js';

interface Session {
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
}

describe('enforcement (emergency pause)', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let enforcement: EnforcementService;
  let containment: ContainmentService;
  let admin: Session;
  let analyst: Session;

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

  /** Seeds an incident + an active containment directly, bypassing the detection pipeline. */
  async function seedActiveBlock(kind: string, key: string): Promise<string> {
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);
    const [inc] = await handle.db
      .insert(incidents)
      .values({
        key: `test:${kind}:${key}:${now.getTime()}`,
        entityKind: kind,
        entityKey: key,
        severity: 'high',
        score: 0.9,
        scoreLower: 0.9,
        scoreUpper: 0.9,
        band: 'high',
        evidence: [],
        abstentions: [],
        firstAttemptAt: now,
        detectedAt: now,
        lastActivityAt: now,
        expiresAt: later,
        thresholdHash: 'test',
      })
      .returning();
    const [con] = await handle.db
      .insert(containments)
      .values({
        incidentId: inc!.id,
        entityKind: kind,
        entityKey: key,
        action: 'contain',
        status: 'active',
        approvalsRequired: 1,
        decision: { action: 'contain', reasons: [], refusals: [] },
        policyVersion: 1,
        policyHash: 'test',
        activatedAt: now,
        expiresAt: later,
      })
      .returning();
    return con!.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    handle = app.get<DbHandle>(DB);
    enforcement = app.get(EnforcementService);
    containment = app.get(ContainmentService);

    const auth = app.get(AuthService);
    await auth.createUser({
      email: 'enf-admin@test.local',
      displayName: 'Enf Admin',
      password: 'correct-horse',
      role: 'admin',
    });
    await auth.createUser({
      email: 'enf-analyst@test.local',
      displayName: 'Enf Analyst',
      password: 'correct-horse',
    });
    admin = await signIn('enf-admin@test.local', 'correct-horse');
    analyst = await signIn('enf-analyst@test.local', 'correct-horse');
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // The tests run in order: the pause set in one persists into the next until resume.

  it('starts enforcing by default', async () => {
    const state = (await admin.get('/api/enforcement')).body as EnforcementState;
    expect(state.paused).toBe(false);
    expect(state.since).toBeNull();
  });

  it('refuses a non-admin', async () => {
    expect((await analyst.post('/api/enforcement/pause', { reason: 'nope' })).status).toBe(403);
  });

  it('pauses, releases the live block, and blocks nobody while paused', async () => {
    const id = await seedActiveBlock('network', 'v1:paused-net');
    // The block is enforced before the pause.
    expect(await containment.blocking([{ kind: 'network', key: 'v1:paused-net' }])).not.toBeNull();

    const res = await admin.post('/api/enforcement/pause', { reason: 'false-positive storm' });
    expect(res.status).toBe(200);
    expect(res.body.state.paused).toBe(true);
    expect(res.body.state.reason).toBe('false-positive storm');
    expect(res.body.released).toBeGreaterThanOrEqual(1);

    // The live containment is actually released, not merely prevented from renewing.
    const [row] = await handle.db.select().from(containments).where(eq(containments.id, id));
    expect(row?.status).toBe('released');

    // And nothing blocks while paused, even before the sweep — the in-memory flag short-circuits it.
    expect(await containment.blocking([{ kind: 'network', key: 'v1:paused-net' }])).toBeNull();
    expect(enforcement.isPaused()).toBe(true);
  });

  it('reports who paused it and why', async () => {
    const state = (await analyst.get('/api/enforcement')).body as EnforcementState;
    expect(state.paused).toBe(true);
    expect(state.by).toBe('Enf Admin');
    expect(state.reason).toBe('false-positive storm');
    expect(state.since).not.toBeNull();
  });

  it('restores the paused state at boot (a restart never silently resumes)', async () => {
    const fresh = new EnforcementService(handle, app.get(AuditService));
    await fresh.onModuleInit();
    expect(fresh.isPaused()).toBe(true);
  });

  it('resumes enforcement, and blocking works again', async () => {
    const res = await admin.post('/api/enforcement/resume', { reason: 'storm over' });
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
    expect(enforcement.isPaused()).toBe(false);

    await seedActiveBlock('network', 'v1:resumed-net');
    expect(await containment.blocking([{ kind: 'network', key: 'v1:resumed-net' }])).not.toBeNull();
  });
});
