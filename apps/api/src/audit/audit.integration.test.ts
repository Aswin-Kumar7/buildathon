import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, desc, eq } from 'drizzle-orm';
import { auditLog, type DbHandle } from '@sentinel/db';
import type {
  AuditListResponse,
  AuditVerifyResponse,
  IncidentListResponse,
} from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';

interface Person {
  post: (path: string, body?: unknown) => request.Test;
  get: (path: string) => request.Test;
}

describe('audit chain', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let ana: Person;
  let ben: Person;
  let incidentId = '';

  async function signIn(email: string, displayName: string): Promise<Person> {
    await app
      .get(AuthService)
      .createUser({ email, password: 'correct-horse', displayName, role: 'analyst' });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'correct-horse' });
    const raw = signedIn.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw ?? ''];
    const cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
    const csrf = signedIn.body.csrfToken as string;

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
    handle = app.get<DbHandle>(DB);

    ana = await signIn('audit-ana@test.local', 'Ana');
    ben = await signIn('audit-ben@test.local', 'Ben');

    // Build a real chain: an attack, an incident, a move, and a full approve-to-active action.
    expect((await ana.post('/api/replay', { family: 'attack_loud' })).status).toBe(200);
    const drain = app.get(DrainService);
    for (let pass = 0; pass < 50; pass += 1) {
      if ((await drain.drainOnce()).claimed === 0) break;
    }
    await ana.post('/api/incidents/evaluate');

    const incidents = (await ana.get('/api/incidents')).body as IncidentListResponse;
    incidentId = incidents.incidents[0]!.id;

    await ana.post(`/api/incidents/${incidentId}/transition`, { to: 'under_review' });

    const proposal = await ana.post(`/api/incidents/${incidentId}/propose`);
    const containmentId = proposal.body.containment.id as string;
    const required = proposal.body.containment.approvalsRequired as number;
    await ana.post(`/api/containments/${containmentId}/approve`);
    if (required > 1) await ben.post(`/api/containments/${containmentId}/approve`);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  const verify = async (): Promise<AuditVerifyResponse> =>
    (await ana.post('/api/audit/verify')).body as AuditVerifyResponse;

  it('records every decision and action as a chained entry', async () => {
    const body = (await ana.get('/api/audit')).body as AuditListResponse;

    const kinds = body.entries.map((e) => e.kind);
    expect(kinds).toContain('incident.transition');
    expect(kinds).toContain('containment.proposed');
    expect(kinds).toContain('containment.approved');
    expect(kinds).toContain('containment.activated');
    // Every entry links to the one before it: the previous entry's hash is this one's prevHash.
    const ordered = [...body.entries].sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!.prevHash).toBe(ordered[i - 1]!.hash);
    }
  });

  it('gathers an incident and its actions into one trail', async () => {
    const body = (await ana.get(`/api/audit?incidentId=${incidentId}`)).body as AuditListResponse;

    expect(body.entries.length).toBeGreaterThan(2);
    expect(body.entries.some((e) => e.subjectType === 'incident')).toBe(true);
    expect(body.entries.some((e) => e.subjectType === 'containment')).toBe(true);
  });

  it('verifies an untouched chain', async () => {
    const result = await verify();
    expect(result.valid).toBe(true);
    expect(result.entries).toBeGreaterThan(3);
    expect(result.head).toMatch(/^[0-9a-f]{64}$/);
  });

  it('catches a mutated row, and clears again once it is put back', async () => {
    // The demo: deliberately corrupt a row and watch the verifier catch it.
    const [target] = await handle.db
      .select({ seq: auditLog.seq, payload: auditLog.payload })
      .from(auditLog)
      .orderBy(asc(auditLog.seq))
      .limit(1)
      .offset(1);
    const seq = target!.seq;
    const original = target!.payload;

    await handle.db
      .update(auditLog)
      .set({ payload: { note: 'quietly changed' } })
      .where(eq(auditLog.seq, seq));

    const broken = await verify();
    expect(broken.valid).toBe(false);
    expect(broken.firstDivergence).toMatchObject({ seq, reason: 'hash-mismatch' });

    // Put it back exactly, and the chain is whole again — proof the check is about the content,
    // not about having been touched.
    await handle.db.update(auditLog).set({ payload: original }).where(eq(auditLog.seq, seq));
    expect((await verify()).valid).toBe(true);
  });

  it('refuses to let two entries share a predecessor', async () => {
    // The fork guard. Two appends that both linked to the same head cannot both exist — the
    // unique constraint on prev_hash is what keeps concurrent writes to a single line.
    const [head] = await handle.db
      .select({ prevHash: auditLog.prevHash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);

    await expect(
      handle.db.insert(auditLog).values({
        at: new Date(),
        kind: 'forged',
        subjectType: 'incident',
        subjectId: '00000000-0000-4000-8000-000000000000',
        payload: {},
        prevHash: head!.prevHash,
        hash: 'deadbeef',
      }),
    ).rejects.toThrow();
  });

  it('catches a deleted row', async () => {
    // Last, because it cannot be undone: removing a middle entry leaves a gap in the sequence
    // that the verifier reports, and the surviving chain stays short.
    const rows = await handle.db
      .select({ seq: auditLog.seq })
      .from(auditLog)
      .orderBy(asc(auditLog.seq));
    const middle = rows[Math.floor(rows.length / 2)]!.seq;

    await handle.db.delete(auditLog).where(eq(auditLog.seq, middle));

    const result = await verify();
    expect(result.valid).toBe(false);
    expect(result.firstDivergence!.reason).toMatch(/sequence-gap|broken-link/);
  });
});
