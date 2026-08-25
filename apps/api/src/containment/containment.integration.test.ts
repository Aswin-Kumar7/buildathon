import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { containments, type DbHandle } from '@sentinel/db';
import type {
  ContainmentResponse,
  IncidentListResponse,
  PolicyResponse,
  SimulationResponse,
} from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';
import { ContainmentService } from './containment.service.js';
import { PolicyService } from '../policy/policy.service.js';

interface Person {
  cookie: string;
  csrf: string;
  post: (path: string, body?: unknown) => request.Test;
  get: (path: string) => request.Test;
}

describe('containment', () => {
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

    ana = await signIn('ana@test.local', 'Ana');
    ben = await signIn('ben@test.local', 'Ben');

    // One loud attack, so there is something a policy would actually act on.
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

  it('serves the policy it is actually running', async () => {
    const body = (await ana.get('/api/policy')).body as PolicyResponse;

    expect(body.version).toBeGreaterThanOrEqual(1);
    expect(body.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(body.thresholds.contain).toBeGreaterThanOrEqual(body.thresholds.stepUp);
  });

  it('does not hand out the allowlist, only its size', async () => {
    // Its entries are pseudonyms of real sessions and networks. A page needs to know they exist,
    // not who they are.
    const body = (await ana.get('/api/policy')).body as PolicyResponse;

    expect(body.allowlisted).toEqual({ sessions: 0, devices: 0, networks: 0 });
    // The counts are reported; the entries are not. `allowlisted` legitimately contains the
    // word, so the check is for the shape that would carry pseudonyms.
    expect(body).not.toHaveProperty('allowlist');
    expect(JSON.stringify(body)).not.toMatch(/v1:[0-9a-f]/);
  });

  it('proposes an action and records who proposed it', async () => {
    const response = await ana.post(`/api/incidents/${incidentId}/propose`, {
      note: 'walking a card list',
    });

    expect(response.status).toBe(201);
    const { containment } = response.body as ContainmentResponse;

    expect(containment.action).toBe('contain');
    expect(containment.status).toBe('proposed');
    expect(containment.approvalsRequired).toBeGreaterThan(0);
    expect(containment.proposedBy).toBe('Ana');
    expect(containment.decision.policyHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('refuses a second proposal while one is live', async () => {
    // Two people acting on the same incident from two tabs is how an entity ends up contained
    // twice with two expiries.
    expect((await ana.post(`/api/incidents/${incidentId}/propose`)).status).toBe(409);
  });

  it('will not let the proposer be the only approver when two are required', async () => {
    // The entire content of dual approval. Without it the requirement is a counter one person
    // can satisfy alone, and the control is decorative.
    const list = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    const id = list.containments[0].id as string;
    const required = list.containments[0].approvalsRequired as number;

    const first = await ana.post(`/api/containments/${id}/approve`);
    expect(first.status).toBe(201);

    if (required > 1) {
      expect((first.body as ContainmentResponse).containment.status).toBe('proposed');
      // Ana again is refused; Ben is not.
      expect((await ana.post(`/api/containments/${id}/approve`)).status).toBe(400);
      expect((await ben.post(`/api/containments/${id}/approve`)).status).toBe(201);
    }

    const detail = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    expect(detail.containments[0].status).toBe('active');
    expect(detail.containments[0].approvals.length).toBe(required);
  });

  it('applies an expiry to anything the shopper would notice', async () => {
    // Nothing this system does to a customer is permanent. The failure mode of a block that
    // never lifts is somebody who can never pay again while nothing appears to have gone wrong.
    const list = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    const containment = list.containments[0];

    expect(containment.action).toBe('contain');
    expect(containment.expiresAt).not.toBeNull();
    expect(containment.expiresAt).toBeGreaterThan(containment.activatedAt);
  });

  it('reports the entity as contained while it is active', async () => {
    const service = app.get(ContainmentService);
    const list = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    const { entityKind, entityKey } = list.containments[0];

    expect(await service.isContained(entityKind, entityKey)).toBe(true);
    expect(await service.isContained(entityKind, 'v1:somebody-else')).toBe(false);
  });

  it('bounds an extension by the ceiling and by how many times', async () => {
    const list = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    const id = list.containments[0].id as string;

    // Extending without limit is how a system arrives at a permanent block by increments, each
    // one individually reasonable.
    expect((await ana.post(`/api/containments/${id}/extend`, { minutes: 600 })).status).toBe(400);

    const ok = await ana.post(`/api/containments/${id}/extend`, { minutes: 15 });
    expect(ok.status).toBe(201);
    expect((ok.body as ContainmentResponse).containment.extensions).toBe(1);
  });

  it('lifts on its own when the time runs out, naming nobody', async () => {
    // The slice's exit condition. An action that needs somebody to remember to undo it is one
    // that will still be in place next month.
    const list = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    const id = list.containments[0].id as string;

    await handle.db
      .update(containments)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(containments.id, id));

    expect(await app.get(ContainmentService).expireDue()).toBe(1);

    const after = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    expect(after.containments[0].status).toBe('expired');
    expect(after.containments[0].endedAt).not.toBeNull();

    const expiry = after.containments[0].history.find(
      (e: { kind: string }) => e.kind === 'expired',
    );
    expect(expiry.actor).toBeNull();
    expect(
      await app
        .get(ContainmentService)
        .isContained(after.containments[0].entityKind, after.containments[0].entityKey),
    ).toBe(false);
  });

  it('keeps every step attributable', async () => {
    // Proposed, approved, activated, extended, expired — with a name against each thing a
    // person did and nobody's against the things the system did.
    const list = (await ana.get(`/api/containments?incidentId=${incidentId}`)).body;
    const history = list.containments[0].history as { kind: string; actor: string | null }[];

    expect(history.map((entry) => entry.kind)).toEqual([
      'proposed',
      'approved',
      ...(list.containments[0].approvals.length > 1 ? ['approved'] : []),
      'activated',
      'extended',
      'expired',
    ]);
    expect(history.find((e) => e.kind === 'proposed')!.actor).toBe('Ana');
    expect(history.find((e) => e.kind === 'activated')!.actor).toBeNull();
  });

  it('refuses to act at all while the kill switch is engaged', async () => {
    // The one control that has to work when every assumption behind the others has failed.
    const policy = app.get(PolicyService);
    const original = policy.policy.killSwitch;
    (policy.policy as { killSwitch: boolean }).killSwitch = true;

    try {
      const list = (await ana.get('/api/incidents')).body as IncidentListResponse;
      const other = list.incidents.find((i) => i.id !== incidentId) ?? list.incidents[0]!;
      const response = await ana.post(`/api/incidents/${other.id}/propose`);

      // Either refused outright, or proposed as an action nobody notices — never containment.
      if (response.status === 201) {
        const { containment } = response.body as ContainmentResponse;
        expect(containment.action).toBe('observe');
        expect(containment.decision.refusals).toContain('kill_switch_engaged');
      }
    } finally {
      (policy.policy as { killSwitch: boolean }).killSwitch = original;
    }
  });
});

describe('policy simulation', () => {
  let app: INestApplication;
  let ana: Person;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    await app.get(AuthService).createUser({
      email: 'sim@test.local',
      password: 'correct-horse',
      displayName: 'Sim',
      role: 'analyst',
    });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sim@test.local', password: 'correct-horse' });
    const raw = signedIn.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw ?? ''];
    const cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';

    ana = {
      cookie,
      csrf: signedIn.body.csrfToken,
      get: (path) => request(app.getHttpServer()).get(path).set('Cookie', cookie),
      post: (path, body) =>
        request(app.getHttpServer())
          .post(path)
          .set('Cookie', cookie)
          .set(CSRF_HEADER, signedIn.body.csrfToken)
          .send(body ?? {}),
    };

    await ana.post('/api/replay', { family: 'attack_loud' });
    const drain = app.get(DrainService);
    for (let pass = 0; pass < 50; pass += 1) {
      if ((await drain.drainOnce()).claimed === 0) break;
    }
    await ana.post('/api/incidents/evaluate');
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('answers what a candidate policy would have done', async () => {
    const source = (await ana.get('/api/policy')).body as PolicyResponse;

    // Tightened where it will actually bite. Raising the containment threshold would not: the
    // loud attack meets every expectation the hypothesis has, so its support is 1.0 and no legal
    // threshold — the field is capped at 1 — is above it. Capping containment at zero is a real
    // question somebody would ask before a busy weekend, and it changes the answer.
    const cautious = `version: ${source.version}
killSwitch: false
thresholds: { stepUp: 0.55, contain: 0.75 }
containment: { defaultMinutes: 30, maxMinutes: 120, maxExtensions: 2 }
approval: { dualApprovalAbovePaise: 50000, containmentAlwaysNeedsApproval: true }
impactCaps: { maxActiveContainments: 0, maxContainmentsPerHour: 10, maxShareOfActiveSessions: 0.05, shareAppliesAboveSessions: 20 }
allowlist: { sessions: [], devices: [], networks: [] }
degradation: { maxFeatureAgeMinutes: 15, requireConfirmedCounts: true, refuseWhenArbitrationAbstained: true }
costs: { chargebackPaise: 150000, blockedShopperPaise: 120000, reviewPaise: 20000 }
`;

    const response = await ana.post('/api/policy/simulate', { policy: cautious });
    expect(response.status).toBe(201);

    const body = response.body as SimulationResponse;
    expect(body.problems, body.problems.join('; ')).toHaveLength(0);
    expect(body.summary.considered, JSON.stringify(body.summary)).toBeGreaterThan(0);

    expect(body.summary.newlyReleased).toBeGreaterThan(0);
    expect(body.summary.newlyContained).toBe(0);
    expect(body.rows.every((row) => row.current.action === 'contain')).toBe(true);
    expect(
      body.rows.every((row) => row.proposed.refusals.includes('too_many_active_containments')),
    ).toBe(true);
  });

  it('answers what a looser policy would newly contain, which is the nervous direction', async () => {
    // Reported on its own rather than folded into "changed": more containment is the direction
    // that costs somebody their checkout, and it is the number a person should have to look at
    // before shipping an edit.
    const source = (await ana.get('/api/policy')).body as PolicyResponse;
    const looser = `version: ${source.version}
killSwitch: false
thresholds: { stepUp: 0.1, contain: 0.2 }
containment: { defaultMinutes: 30, maxMinutes: 120, maxExtensions: 2 }
approval: { dualApprovalAbovePaise: 50000, containmentAlwaysNeedsApproval: true }
impactCaps: { maxActiveContainments: 5, maxContainmentsPerHour: 10, maxShareOfActiveSessions: 0.05, shareAppliesAboveSessions: 20 }
allowlist: { sessions: [], devices: [], networks: [] }
degradation: { maxFeatureAgeMinutes: 15, requireConfirmedCounts: true, refuseWhenArbitrationAbstained: true }
costs: { chargebackPaise: 150000, blockedShopperPaise: 120000, reviewPaise: 20000 }
`;

    const body = (await ana.post('/api/policy/simulate', { policy: looser }))
      .body as SimulationResponse;

    expect(body.problems).toHaveLength(0);
    expect(body.summary.newlyContained).toBe(0);
    expect(body.summary.considered).toBeGreaterThan(0);
  });

  it('reports a broken candidate rather than throwing at the person editing it', async () => {
    const response = await ana.post('/api/policy/simulate', { policy: 'version: 1\n' });

    expect(response.status).toBe(201);
    const body = response.body as SimulationResponse;
    expect(body.problems.length).toBeGreaterThan(3);
    expect(body.rows).toHaveLength(0);
  });

  it('changes nothing', async () => {
    // A simulator with a side effect is a deploy with extra steps.
    const before = (await ana.get('/api/policy')).body as PolicyResponse;
    await ana.post('/api/policy/simulate', {
      policy: 'version: 99\nkillSwitch: true\n',
    });
    const after = (await ana.get('/api/policy')).body as PolicyResponse;

    expect(after).toEqual(before);
    expect((await ana.get('/api/containments')).body.containments).toHaveLength(0);
  });
});
