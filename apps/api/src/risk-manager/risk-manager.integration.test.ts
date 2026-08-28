import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { auditLog, type DbHandle } from '@sentinel/db';
import type {
  AuditListResponse,
  ContainmentListResponse,
  IncidentListResponse,
  PolicyPreviewResponse,
  RiskAcceptResponse,
  RiskRecommendationResponse,
} from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';

interface Person {
  cookie: string;
  csrf: string;
  post: (path: string, body?: unknown) => request.Test;
  get: (path: string) => request.Test;
}

describe('risk-manager', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let ana: Person;
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
      cookie,
      csrf,
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

    ana = await signIn('rm-ana@test.local', 'Ana');

    // A loud attack, so the policy engine would actually support a containment.
    expect((await ana.post('/api/replay', { family: 'attack_loud' })).status).toBe(200);
    const drain = app.get(DrainService);
    for (let pass = 0; pass < 50; pass += 1) {
      if ((await drain.drainOnce()).claimed === 0) break;
    }
    await ana.post('/api/incidents/evaluate');

    const list = (await ana.get('/api/incidents')).body as IncidentListResponse;
    expect(list.incidents.length).toBeGreaterThan(0);
    incidentId = list.incidents[0]!.id;
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('recommends contain on a contain-eligible incident, grounded and dropping nothing', async () => {
    const { recommendation } = (await ana.get(`/api/incidents/${incidentId}/recommendation`))
      .body as RiskRecommendationResponse;

    expect(recommendation).not.toBeNull();
    expect(recommendation!.action).toBe('contain');
    expect(recommendation!.policyAction).toBe('contain');
    expect(recommendation!.alignment).toBe('aligned');
    expect(recommendation!.source).toBe('local'); // no GROQ configured → deterministic tier
    expect(recommendation!.dropped).toBe(0);
    expect(recommendation!.keyReasons.length).toBeGreaterThan(0);
    expect(recommendation!.groundingHash).toMatch(/^[0-9a-f]{32}$/);
    expect(recommendation!.reasoningVersion).toBe('rm-r1');
  });

  it('exposes the read-only policy preview without proposing anything', async () => {
    const { decision } = (await ana.get(`/api/incidents/${incidentId}/policy-preview`))
      .body as PolicyPreviewResponse;
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe('contain');
    // Read-only: no containment was created by previewing.
    const { containments } = (await ana.get(`/api/containments?incidentId=${incidentId}`))
      .body as ContainmentListResponse;
    expect(containments).toHaveLength(0);
  });

  it('refuses acceptance when the grounding hash is stale', async () => {
    const response = await ana.post(`/api/incidents/${incidentId}/recommendation/accept`, {
      groundingHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
    });
    expect(response.status).toBe(409);
  });

  it('records a rejection with provenance, without acting', async () => {
    expect((await ana.post(`/api/incidents/${incidentId}/recommendation/reject`)).status).toBe(201);
    const { entries } = (await ana.get(`/api/audit?incidentId=${incidentId}`))
      .body as AuditListResponse;
    const rejected = entries.find((e) => e.kind === 'recommendation.rejected');
    expect(rejected).toBeDefined();
    expect((rejected!.payload as { action: string }).action).toBe('contain');
    // Rejecting proposes nothing.
    const { containments } = (await ana.get(`/api/containments?incidentId=${incidentId}`))
      .body as ContainmentListResponse;
    expect(containments).toHaveLength(0);
  });

  it('accepts contain: proposes through the existing rail and audits with provenance', async () => {
    const { recommendation } = (await ana.get(`/api/incidents/${incidentId}/recommendation`))
      .body as RiskRecommendationResponse;
    const hash = recommendation!.groundingHash;

    const accept = await ana.post(`/api/incidents/${incidentId}/recommendation/accept`, {
      groundingHash: hash,
      note: 'looks like card testing',
    });
    expect(accept.status).toBe(201);
    expect((accept.body as RiskAcceptResponse).outcome).toBe('containment_proposed');

    // The existing rail actually proposed a containment, still awaiting approval.
    const { containments } = (await ana.get(`/api/containments?incidentId=${incidentId}`))
      .body as ContainmentListResponse;
    expect(containments).toHaveLength(1);
    expect(containments[0]!.action).toBe('contain');
    expect(containments[0]!.status).toBe('proposed');
    expect(containments[0]!.approvalsRequired).toBeGreaterThan(0);

    // The acceptance is on the chain, with the reasoning version + grounding hash as provenance.
    const { entries } = (await ana.get(`/api/audit?incidentId=${incidentId}`))
      .body as AuditListResponse;
    const accepted = entries.find((e) => e.kind === 'recommendation.accepted');
    expect(accepted).toBeDefined();
    expect(accepted!.actor).toBe('Ana');
    const payload = accepted!.payload as {
      action: string;
      groundingHash: string;
      reasoningVersion: string;
    };
    expect(payload.action).toBe('contain');
    expect(payload.groundingHash).toBe(hash);

    // Provenance is written into the hashed columns, not just the payload.
    const [row] = await handle.db
      .select({ mv: auditLog.modelVersion, fh: auditLog.featureSnapshotHash })
      .from(auditLog)
      .where(eq(auditLog.kind, 'recommendation.accepted'))
      .orderBy(desc(auditLog.seq))
      .limit(1);
    expect(row?.mv).toBe('rm-r1');
    expect(row?.fh).toBe(hash);
  });

  it('keeps the audit chain intact through the whole loop', async () => {
    const verify = await ana.post('/api/audit/verify');
    expect(verify.body.valid).toBe(true);
  });

  it('refuses to act on a closed incident', async () => {
    // Contain was proposed above; resolving the incident closes it.
    await ana.post(`/api/incidents/${incidentId}/transition`, {
      to: 'resolved',
      verdict: 'confirmed_abuse',
    });
    const { recommendation } = (await ana.get(`/api/incidents/${incidentId}/recommendation`))
      .body as RiskRecommendationResponse;
    const response = await ana.post(`/api/incidents/${incidentId}/recommendation/accept`, {
      groundingHash: recommendation!.groundingHash,
    });
    expect(response.status).toBe(400);
  });
});
